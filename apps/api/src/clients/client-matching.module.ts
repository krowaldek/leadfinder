import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../database/database.module.js";
import { LogsModule } from "../logs/logs.module.js";
import { ClientMatchingService } from "./client-matching.service.js";
import { ClientMatchingProcessor } from "./client-matching.processor.js";
import { CLIENT_MATCHING_QUEUE } from "./client-matching.constants.js";

@Module({
  imports: [
    DatabaseModule,
    ConfigModule,
    LogsModule,
    BullModule.registerQueue({ name: CLIENT_MATCHING_QUEUE }),
  ],
  providers: [ClientMatchingService, ClientMatchingProcessor],
  exports: [ClientMatchingService, BullModule],
})
export class ClientMatchingModule {}
