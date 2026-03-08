import { Module } from "@nestjs/common";
import { NormalizationService } from "./normalization.service.js";
import { DatabaseModule } from "../database/database.module.js";

@Module({
  imports: [DatabaseModule],
  providers: [NormalizationService],
  exports: [NormalizationService],
})
export class NormalizationModule {}
