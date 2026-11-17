import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { optionalAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.routes.js";
import { websitesRouter } from "./routes/websites.routes.js";
import { reportsRouter } from "./routes/reports.routes.js";
import { syncRouter } from "./routes/sync.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { dbHealthCheck } from "./db/pool.js";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.isProduction ? 1 : false);
// app.use(cors({
//   origin: env.FRONTEND_URL,
//   credentials: true,
//   methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
//   allowedHeaders: ["Content-Type", "Authorization"]
// }));


const allowedOrigins = new Set([
  new URL(env.FRONTEND_URL).origin,
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);


// app.use(cors({
//   origin: (origin, callback) => {
//     if (!origin || allowedOrigins.includes(origin)) {
//       return callback(null, true);
//     }

//     return callback(new Error(`CORS blocked origin: ${origin}`));
//   },
//   credentials: true,
//   exposedHeaders: ["Content-Disposition"]
// }));
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Content-Disposition"],
  credentials: true
}));

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/health", async (_req, res) => {
  try {
    await dbHealthCheck();
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "degraded", database: "unavailable" });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/admin", optionalAuth, adminRouter);
app.use("/api/websites", optionalAuth, websitesRouter);
app.use("/api/websites", optionalAuth, reportsRouter);
app.use("/api/sync-jobs", optionalAuth, syncRouter);


app.use((req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `Route not found: ${req.method} ${req.path}` } });
});

app.use((error, _req, res, _next) => {
  const status = Number(error.status) || 500;
  const code = error.code || "INTERNAL_SERVER_ERROR";
  if (status >= 500) console.error("API error:", error.message);
  if (_req.path.startsWith("/api/admin/") || _req.path === "/api/auth/invitations/accept") {
    return res.status(status).json({
      success: false,
      message: status >= 500 && env.isProduction ? "An unexpected server error occurred." : error.message,
      code
    });
  }
  res.status(status).json({
    error: {
      code,
      message: status >= 500 && env.isProduction ? "An unexpected server error occurred." : error.message
    }
  });
});
