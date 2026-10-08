import cors from "cors";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { config } from "./config.js";
import { checkDatabaseConnection, databasePool } from "./database.js";
import { authRouter } from "./auth.js";
import { productsRouter } from "./products.js";
import { productLocationsRouter } from "./product-locations.js";
import { receivingRouter } from "./receiving.js";
import { salesRouter } from "./sales.js";
import { stockAuditsRouter } from "./stock-audits.js";
import { paymentReconciliationRouter } from "./payment-reconciliation.js";
import { staffActivitiesRouter } from "./staff-activities.js";
import { dashboardRouter } from "./dashboard.js";
import { reportsRouter } from "./reports.js";
import { aiAssistantRouter } from "./ai-assistant.js";

export const app = express();
const PgSession = connectPgSimple(session);
const sessionCookieName = "smartstock.sid";

if (config.production) {
  app.set("trust proxy", 1);
}

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      callback(null, !origin || config.allowedOrigins.includes(origin));
    },
  }),
);
app.use(express.json());
app.use(
  session({
    name: sessionCookieName,
    store: new PgSession({
      pool: databasePool,
      schemaName: "public",
      tableName: "smartstock_sessions",
      createTableIfMissing: false,
      pruneSessionInterval: 15 * 60,
      ttl: 8 * 60 * 60,
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.production,
    sameSite: config.production ? "none" : "lax",
      maxAge: 8 * 60 * 60 * 1000,
      path: "/",
    },
  }),
);

app.use("/api/auth", authRouter);
app.use("/api", productLocationsRouter);
app.use("/api/products", productsRouter);
app.use("/api/receiving", receivingRouter);
app.use("/api/sales", salesRouter);
app.use("/api/stock-audits", stockAuditsRouter);
app.use("/api/payment-reconciliation", paymentReconciliationRouter);
app.use("/api/staff-activities", staffActivitiesRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/ai-assistant", aiAssistantRouter);

app.get("/api/health", async (_request, response) => {
  try {
    await checkDatabaseConnection();
    response.status(200).json({
      success: true,
      message: "SmartStock Backend Connected",
      database: "connected",
    });
  } catch (error) {
    console.error(
      "Database health check failed:",
      error.code ?? error.name ?? "unknown database error",
    );
    response.status(503).json({
      success: false,
      message: "SmartStock Backend Running, database connection failed",
      database: "disconnected",
      error: "Database health check failed. Verify SUPABASE_DB_URL and database availability.",
    });
  }
});

app.use((error, _request, response, _next) => {
  if (error?.type === "entity.parse.failed" && error?.status === 400) {
    response.status(400).json({
      success: false,
      error: "Request body must contain valid JSON.",
    });
    return;
  }

  console.error(
    "Request failed:",
    error.code ?? error.name ?? "unknown server error",
  );
  response.status(500).json({
    success: false,
    error: "The request could not be completed.",
  });
});
