import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { DatabaseModule } from "../database/database.module.js";
import { ClientMatchingService } from "./client-matching.service.js";
import { ClientMatchingProcessor } from "./client-matching.processor.js";
import { CLIENT_MATCHING_QUEUE } from "./client-matching.constants.js";

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({ name: CLIENT_MATCHING_QUEUE }),
  ],
  providers: [ClientMatchingService, ClientMatchingProcessor],
  exports: [ClientMatchingService, BullModule],
})
export class ClientMatchingModule {}
