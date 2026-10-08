import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const backendRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(backendRoot, "..");
dotenv.config({
  path: [
    path.join(backendRoot, ".env"),
    path.join(projectRoot, ".env"),
  ],
});

const defaultFrontendOrigin = process.env.NODE_ENV === "production"
  ? ""
  : "http://localhost:5173";
const allowedOrigins = (process.env.FRONTEND_ORIGIN ?? defaultFrontendOrigin)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const configuredPort = Number(process.env.PORT);

export const config = {
  port: Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535
    ? configuredPort
    : 3001,
  allowedOrigins,
  databaseUrl: process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL,
  sessionSecret: process.env.SESSION_SECRET,
  production: process.env.NODE_ENV === "production",
  aiProvider: process.env.AI_PROVIDER ?? "openai",
  aiModel: process.env.AI_MODEL ?? "gpt-4o-mini",
  aiApiKey: process.env.AI_API_KEY,
  aiBaseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
};

if (!config.sessionSecret || Buffer.byteLength(config.sessionSecret) < 32) {
  throw new Error("SESSION_SECRET must be configured with at least 32 bytes");
}
