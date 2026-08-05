import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { errorHandler } from "./middleware/errors.js";
import { authRouter } from "./routes/auth.js";
import { templatesRouter } from "./routes/templates.js";
import { resumesRouter } from "./routes/resumes.js";
import { closeBrowser } from "./services/pdf.js";

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: config.webOrigin,
    // Required for the httpOnly auth cookie to travel cross-origin in dev.
    credentials: true,
  }),
);
// Resume documents are sizeable JSON; the default 100kb limit rejects autosaves.
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRouter);

// Mount OAuth routes lazily — only when at least one provider is configured.
// This keeps the API boot path identical for deployments without credentials.
// The import is awaited rather than fired-and-forgotten: Express matches
// middleware in registration order, so a router added after the 404 catch-all
// below would never be reached.
if (config.oauthEnabled) {
  const { createOAuthRouter } = await import("./routes/oauth.js");
  app.use("/auth", createOAuthRouter());
}
app.use("/templates", templatesRouter);
app.use("/resumes", resumesRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`  api ready on http://localhost:${config.port}`);
});

// Release the Chromium process on restart, or --watch reloads leak browsers.
async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down`);
  server.close();
  await closeBrowser();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
