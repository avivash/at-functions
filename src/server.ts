import Fastify from "fastify";
import cors from "@fastify/cors";
import runRoute from "./routes/run.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "127.0.0.1";

// Pino's thread-stream transport (used by pino-pretty) does not work on Bun.
const usePrettyTransport =
  process.env.NODE_ENV !== "production" && !("bun" in process.versions);

const server = Fastify({
  logger: {
    level: "info",
    transport: usePrettyTransport
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  },
  bodyLimit: 1024 * 1024, // 1 MB request body limit
});

await server.register(cors, {
  origin: ["https://functions.at", /\.functions\.at$/],
});

await server.register(runRoute);

// Health check
server.get("/health", async () => ({ ok: true }));

try {
  await server.listen({ port: PORT, host: HOST });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
