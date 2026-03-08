import { Module } from "@nestjs/common";
import { NormalizationService } from "./normalization.service.js";
import { DatabaseModule } from "../database/database.module.js";
import { EmbeddingModule } from "../embedding/embedding.module.js";

@Module({
  imports: [DatabaseModule, EmbeddingModule],
  providers: [NormalizationService],
  exports: [NormalizationService],
})
export class NormalizationModule {}
