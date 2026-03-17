import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  AnnouncementsListQuery,
  InternalAnnouncementChatCommentRequest,
  InternalAnnouncementChatListQuery,
  announcementsListQuerySchema,
  internalAnnouncementChatCommentRequestSchema,
  internalAnnouncementChatListQuerySchema,
  internalAnnouncementPromptRequestSchema,
  type AuthUser,
  type InternalAnnouncementPromptRequest,
} from "@leadfinder/contracts";
import { AnnouncementsService } from "./announcements.service.js";
import { AnnouncementReportService } from "./announcement-report.service.js";
import { InternalAnnouncementPromptService } from "./internal-announcement-prompt.service.js";
import { JwtAuthGuard } from "../common/jwt-auth.guard.js";
import { RolesGuard } from "../common/roles.guard.js";
import { Roles } from "../common/roles.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { CurrentUser } from "../common/current-user.decorator.js";

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

  @Get("internal/chats")
  async findInternalChats(
    @Query(new ZodValidationPipe(internalAnnouncementChatListQuerySchema))
    query: InternalAnnouncementChatListQuery,
  ) {
    return this.announcementsService.findInternalPromptChats(query);
  }

  @Get("internal/chats/:id")
  async findInternalChat(@Param("id") id: string) {
    return {
      data: await this.announcementsService.findInternalPromptChat(id),
    };
  }

  @Post("internal/chats/:id/comments")
  @HttpCode(200)
  async addInternalChatComment(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(internalAnnouncementChatCommentRequestSchema))
    body: InternalAnnouncementChatCommentRequest,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      data: await this.announcementsService.addInternalPromptChatComment(id, body.content, user),
    };
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
