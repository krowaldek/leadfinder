import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { JobLoggerService } from "./job-logger.service.js";
import { LogsService } from "./logs.service.js";
import { LogsController } from "./logs.controller.js";

@Module({
  imports: [DatabaseModule],
  controllers: [LogsController],
  providers: [JobLoggerService, LogsService],
  exports: [JobLoggerService],
})
export class LogsModule {}
