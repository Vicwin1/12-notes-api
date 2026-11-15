import cors from "cors";
import express from "express";
import helmet from "helmet";
import authRouter from "./routes/auth.js";
import healthRouter from "./routes/health.js";
import notesRouter from "./routes/notes.js";

const app = express();

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    console.info(
      JSON.stringify({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      }),
    );
  });
  next();
});

app.use(helmet());
app.use(cors({ origin: ["http://localhost:5173", "http://localhost:3000"] }));
app.use(express.json({ limit: "100kb" }));

app.use("/api/auth", authRouter);
app.use("/api/health", healthRouter);
app.use("/api/notes", notesRouter);

app.use((req, res) => {
  res.status(404).json({ error: { message: "Not found." } });
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const status =
    Number.isInteger(err.status) && err.status >= 400 && err.status <= 599
      ? err.status
      : 500;
  const isProduction = process.env.NODE_ENV === "production";
  const message =
    isProduction && status >= 500 ? "Internal server error." : err.message;

  if (status >= 500) {
    console.error(
      JSON.stringify({
        message: isProduction ? "Internal server error." : err.message,
        ...(isProduction ? {} : { stack: err.stack }),
      }),
    );
  }

  return res.status(status).json({ error: { message } });
});

export default app;
