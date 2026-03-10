import { Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  AnnouncementsListQuery,
  announcementsListQuerySchema,
} from "@leadfinder/contracts";
import { AnnouncementsService } from "./announcements.service.js";
import { AnnouncementReportService } from "./announcement-report.service.js";
import { JwtAuthGuard } from "../common/jwt-auth.guard.js";
import { RolesGuard } from "../common/roles.guard.js";
import { Roles } from "../common/roles.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("SUPER_ADMIN", "ADMIN")
@Controller("announcements")
export class AnnouncementsController {
  constructor(
    @Inject(AnnouncementsService)
    private readonly announcementsService: AnnouncementsService,
    @Inject(AnnouncementReportService)
    private readonly reportService: AnnouncementReportService,
  ) {}

  @Get()
  async findAll(
    @Query(new ZodValidationPipe(announcementsListQuerySchema))
    query: AnnouncementsListQuery,
  ) {
    return this.announcementsService.findAll(query);
  }

  @Get(":id")
  async findOne(@Param("id") id: string) {
    return {
      data: await this.announcementsService.findOne(id),
    };
  }

  /** Generuje (lub regeneruje) pełny raport analityczny. Może trwać kilkanaście sekund. */
  @Post(":id/report")
  @HttpCode(200)
  async generateReport(@Param("id") id: string) {
    const report = await this.reportService.generateReport(id);
    return { data: { detailedReport: report } };
  }
}
