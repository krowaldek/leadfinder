import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../database/database.module.js";
import { ClientMatchingModule } from "./client-matching.module.js";
import { ClientsService } from "./clients.service.js";
import { ClientPromptService } from "./client-prompt.service.js";
import { ClientsController } from "./clients.controller.js";
import { EMBEDDING_QUEUE } from "../embedding/embedding-queue.constants.js";

@Module({
  imports: [
    DatabaseModule,
    ClientMatchingModule,
    ConfigModule,
    BullModule.registerQueue({ name: EMBEDDING_QUEUE }),
  ],
  providers: [ClientsService, ClientPromptService],
  controllers: [ClientsController],
  exports: [ClientsService],
})
export class ClientsModule {}
