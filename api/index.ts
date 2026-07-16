// Vercel serverless entry point.
// This is ONLY used when deploying the backend to Vercel for testing.
// The regular server deployment (university on-premise server) still
// uses src/main.ts + PM2 — that path is untouched.
//
// How it works: Vercel calls this function on every request. We build
// the NestJS app once (using an Express adapter) and cache it in memory
// (`cachedServer`) so subsequent requests in the same warm function
// instance reuse it instead of rebuilding NestJS every time.

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import express, { Express } from "express";
import helmet from "helmet";
import compression from "compression";
import { AppModule } from "../src/app.module";
import { HttpExceptionLoggerFilter } from "../src/common/filters/http-exception-logger.filter";

let cachedServer: Express | null = null;

async function bootstrapServer(): Promise<Express> {
  if (cachedServer) {
    return cachedServer;
  }

  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

  app.use(helmet());
  app.use(compression());

  app.enableCors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionLoggerFilter());
  app.setGlobalPrefix("api");

  await app.init();

  cachedServer = expressApp;
  return expressApp;
}

export default async function handler(req: any, res: any) {
  const server = await bootstrapServer();
  server(req, res);
}
