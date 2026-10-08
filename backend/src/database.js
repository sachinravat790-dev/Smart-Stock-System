import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

function normalizeSessionPoolerUrl(connectionString) {
  const parts = connectionString.match(
    /^(postgres(?:ql)?:\/\/)([^:/?#@]+):([\s\S]*)@((?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)*pooler\.supabase\.com):(\d+)(\/[^?#]*)(\?[^#]*)?$/i,
  );

  if (!parts) {
    return connectionString;
  }

  const password = decodeURIComponent(
    parts[3].replace(/%(?![0-9a-f]{2})/gi, "%25"),
  );
  const encodedPassword = encodeURIComponent(password).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${parts[1]}${parts[2]}:${encodedPassword}@${parts[4]}:${parts[5]}${parts[6]}${parts[7] ?? ""}`;
}

export const databasePool = config.databaseUrl
  ? new Pool({
      connectionString: normalizeSessionPoolerUrl(config.databaseUrl),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 5,
    })
  : null;

export async function checkDatabaseConnection() {
  if (!databasePool) {
    throw new Error("SUPABASE_DB_URL is not configured");
  }

  await databasePool.query("SELECT 1");
}
