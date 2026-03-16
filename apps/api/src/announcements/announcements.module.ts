import { Module } from "@nestjs/common";
import { AnnouncementsService } from "./announcements.service.js";
import { AnnouncementsController } from "./announcements.controller.js";
import { AnnouncementReportService } from "./announcement-report.service.js";
import { InternalAnnouncementPromptService } from "./internal-announcement-prompt.service.js";
import { DatabaseModule } from "../database/database.module.js";
import { LogsModule } from "../logs/logs.module.js";
import { EmbeddingModule } from "../embedding/embedding.module.js";

@Module({
  imports: [DatabaseModule, LogsModule, EmbeddingModule],
  providers: [AnnouncementsService, AnnouncementReportService, InternalAnnouncementPromptService],
  controllers: [AnnouncementsController],
  exports: [AnnouncementsService, AnnouncementReportService, InternalAnnouncementPromptService],
})
export class AnnouncementsModule {}
