import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { LogsService } from "../logs/logs.service.js";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error"],
  });

  const logsService = app.get(LogsService);
  const progress = await logsService.getReembedProgress();

  console.log(JSON.stringify(progress, null, 2));

  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});