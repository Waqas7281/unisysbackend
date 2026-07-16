import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import compression from "compression";
import { AppModule } from "./app.module";
import { HttpExceptionLoggerFilter } from "./common/filters/http-exception-logger.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.use(compression());

  app.enableCors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionLoggerFilter());
  app.setGlobalPrefix("api");

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`University System API running on http://localhost:${port}/api`);
}
bootstrap();
