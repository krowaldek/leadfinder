import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { SearchService } from "./search.service.js";
import { SearchController } from "./search.controller.js";

@Module({
  imports: [DatabaseModule],
  providers: [SearchService],
  controllers: [SearchController],
  exports: [SearchService],
})
export class SearchModule {}
