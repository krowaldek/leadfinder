import { Module } from "@nestjs/common";
import { AnnouncementsService } from "./announcements.service.js";
import { AnnouncementsController } from "./announcements.controller.js";
import { AnnouncementReportService } from "./announcement-report.service.js";
import { DatabaseModule } from "../database/database.module.js";
import { LogsModule } from "../logs/logs.module.js";

@Module({
  imports: [DatabaseModule, LogsModule],
  providers: [AnnouncementsService, AnnouncementReportService],
  controllers: [AnnouncementsController],
})
export class AnnouncementsModule {}
