import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { ConfigService } from "@nestjs/config";
import cookieParser from "cookie-parser";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.use(cookieParser());

  app.enableCors({
    origin: true,
    credentials: true,
  });

  const port = config.get<number>("API_PORT") ?? 3001;
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}

void bootstrap();
