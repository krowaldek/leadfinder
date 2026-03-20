import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { LogsModule } from "../logs/logs.module.js";
import { SearchService } from "./search.service.js";
import { SearchController } from "./search.controller.js";

@Module({
  imports: [DatabaseModule, LogsModule],
  providers: [SearchService],
  controllers: [SearchController],
  exports: [SearchService],
})
export class SearchModule {}
