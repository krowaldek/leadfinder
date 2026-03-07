import { Module } from "@nestjs/common";
import { AnnouncementsService } from "./announcements.service.js";
import { AnnouncementsController } from "./announcements.controller.js";
import { DatabaseModule } from "../database/database.module.js";

@Module({
  imports: [DatabaseModule],
  providers: [AnnouncementsService],
  controllers: [AnnouncementsController],
})
export class AnnouncementsModule {}
