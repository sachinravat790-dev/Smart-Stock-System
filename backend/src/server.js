import { app } from "./app.js";
import { config } from "./config.js";
import { databasePool } from "./database.js";

const server = app.listen(config.port, () => {
  console.log(`SmartStock backend listening on port ${config.port}`);
});

async function shutDown(signal) {
  console.log(`${signal} received; shutting down SmartStock backend`);
  server.close(async (serverError) => {
    if (serverError) {
      console.error("Error while closing the HTTP server:", serverError);
      process.exitCode = 1;
    }

    try {
      await databasePool?.end();
    } catch (databaseError) {
      console.error("Error while closing the database pool:", databaseError);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => void shutDown("SIGINT"));
process.on("SIGTERM", () => void shutDown("SIGTERM"));
