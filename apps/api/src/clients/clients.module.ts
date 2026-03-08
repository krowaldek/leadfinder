import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { ClientMatchingModule } from "./client-matching.module.js";
import { ClientsService } from "./clients.service.js";
import { ClientPromptService } from "./client-prompt.service.js";
import { ClientsController } from "./clients.controller.js";

@Module({
  imports: [DatabaseModule, ClientMatchingModule],
  providers: [ClientsService, ClientPromptService],
  controllers: [ClientsController],
  exports: [ClientsService],
})
export class ClientsModule {}
