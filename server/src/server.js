import { buildApp } from "./app.js";

const app = buildApp({
  dbPath: process.env.DB_PATH || "/data/manhunt.db",
  origins: (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  logger: { level: process.env.LOG_LEVEL || "info" },
});
const shutdown = () => app.close().then(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await app.listen({ host: process.env.HOST || "0.0.0.0", port: +(process.env.PORT || 8084) });
