import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  AnnouncementsListQuery,
  announcementsListQuerySchema,
  internalAnnouncementPromptRequestSchema,
  type InternalAnnouncementPromptRequest,
} from "@leadfinder/contracts";
import { AnnouncementsService } from "./announcements.service.js";
import { AnnouncementReportService } from "./announcement-report.service.js";
import { InternalAnnouncementPromptService } from "./internal-announcement-prompt.service.js";
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
    @Inject(InternalAnnouncementPromptService)
    private readonly internalPromptService: InternalAnnouncementPromptService,
  ) {}

  @Post("internal/prompt")
  @HttpCode(200)
  async processInternalPrompt(
    @Body(new ZodValidationPipe(internalAnnouncementPromptRequestSchema))
    body: InternalAnnouncementPromptRequest,
  ) {
    return this.internalPromptService.processMessage(body.sessionId, body.message);
  }

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

  /** Generates (or regenerates) the detailed analytical report for an announcement. */
  @Post(":id/report")
  @HttpCode(200)
  async generateReport(@Param("id") id: string) {
    const detailedReport = await this.reportService.generateReport(id);
    return { data: { detailedReport } };
  }
}
