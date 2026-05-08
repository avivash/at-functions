import Fastify from "fastify";
import cors from "@fastify/cors";
import runRoute from "./routes/run.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "127.0.0.1";

const usePrettyTransport = process.env.NODE_ENV !== "production";

const server = Fastify({
  logger: {
    level: "info",
    transport: usePrettyTransport
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  },
  bodyLimit: 1024 * 1024, // 1 MB request body limit
});

/** Browser Origin header values allowed to call this API (cross-origin from the UI). */
const FUNCTIONS_AT_ORIGIN_RE = /^https:\/\/([\w-]+\.)*functions\.at$/;

const EXTRA_CORS_ORIGINS = (process.env.ATFUNCTIONS_CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (EXTRA_CORS_ORIGINS.includes(origin)) return true;
  return FUNCTIONS_AT_ORIGIN_RE.test(origin);
}

await server.register(cors, {
  origin: (origin, cb) => cb(null, isAllowedCorsOrigin(origin)),
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
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
