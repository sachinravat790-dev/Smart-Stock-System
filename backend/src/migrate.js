import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databasePool } from "./database.js";

const migrationDirectory = fileURLToPath(
  new URL("../../database/migrations/", import.meta.url),
);

if (!databasePool) {
  throw new Error("SUPABASE_DB_URL is not configured");
}

try {
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort();

  for (const file of migrationFiles) {
    const migration = await readFile(path.join(migrationDirectory, file), "utf8");
    await databasePool.query(migration);
    console.log(`Database migration ${file} applied successfully.`);
  }
} catch (error) {
  console.error(
    "Database migration failed:",
    error.code ?? error.name ?? "unknown database error",
  );
  process.exitCode = 1;
} finally {
  await databasePool.end();
}
