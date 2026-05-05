/**
 * executeComponent.ts
 *
 * Executes a WASI Component Model WASM binary by spawning a child Node.js
 * process (componentRunner.mjs) that uses jco's programmatic transpile API.
 *
 * Why a child process?
 *   jco uses Node.js internals (worker threads, tcp_wrap, etc.) that work best
 *   under a dedicated `node` process. We isolate it to keep the main server
 *   process simple and to avoid coupling the runtime to jco’s constraints.
 *
 * Protocol with child process:
 *   stdin  → JSON: { wasmBase64: string, inputJson: string }
 *   stdout → JSON: { ok: true, result: string } | { ok: false, error: string }
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Resolve path to the runner script relative to this source file.
// Works both in dev (source tree) and compiled `dist/`.
const RUNNER_PATH = fileURLToPath(
  new URL("./componentRunner.mjs", import.meta.url)
);

export async function executeComponent(
  wasmBytes: Uint8Array,
  input: unknown
): Promise<unknown> {
  const wasmBase64 = Buffer.from(wasmBytes).toString("base64");
  const inputJson = JSON.stringify(input);
  const payload = JSON.stringify({ wasmBase64, inputJson });

  return new Promise<unknown>((resolve, reject) => {
    const child = spawn("node", [RUNNER_PATH], {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => outChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));

    child.on("error", (err) => {
      reject(
        new Error(
          `Failed to spawn component runner (is Node.js installed?): ${err.message}`
        )
      );
    });

    child.on("close", (code) => {
      const stdout = Buffer.concat(outChunks).toString("utf8").trim();
      const stderr = Buffer.concat(errChunks).toString("utf8").trim();

      if (!stdout) {
        return reject(
          new Error(
            `Component runner exited with code ${code} and no output.` +
              (stderr ? `\nstderr: ${stderr}` : "")
          )
        );
      }

      let parsed: { ok: boolean; result?: string; error?: string };
      try {
        parsed = JSON.parse(stdout);
      } catch {
        return reject(
          new Error(
            `Component runner returned invalid JSON: ${stdout}` +
              (stderr ? `\nstderr: ${stderr}` : "")
          )
        );
      }

      if (!parsed.ok) {
        const detail = stderr ? `\n${stderr}` : "";
        return reject(new Error((parsed.error ?? "Component runner failed") + detail));
      }

      // The runner returns the component's JSON string output in `result`.
      try {
        resolve(JSON.parse(parsed.result!));
      } catch {
        // If for some reason result isn't valid JSON, return as-is.
        resolve(parsed.result);
      }
    });

    child.stdin.write(payload, "utf8");
    child.stdin.end();
  });
}
