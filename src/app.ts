import express, { type Express } from "express";

import type { AppConfig } from "./config.js";
import { errorHandler, handleProcess, handleVideoThumbnail, notFound } from "./http/handlers.js";

export function createApp(config: AppConfig): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/", (_req, res) => {
    res.json({
      name: "image-process-service",
      endpoints: {
        health: "/health",
        process: "/process",
        videoThumbnail: "/video/thumbnail",
      },
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/process", (req, res, next) => {
    void handleProcess(req, res, next, config);
  });
  app.post("/process", (req, res, next) => {
    void handleProcess(req, res, next, config);
  });
  app.get("/video/thumbnail", (req, res, next) => {
    void handleVideoThumbnail(req, res, next, config);
  });
  app.post("/video/thumbnail", (req, res, next) => {
    void handleVideoThumbnail(req, res, next, config);
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
