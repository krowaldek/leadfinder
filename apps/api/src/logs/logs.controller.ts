import {
  Controller,
  Get,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  Inject,
} from "@nestjs/common";
import { JwtAuthGuard } from "../common/jwt-auth.guard.js";
import { RolesGuard } from "../common/roles.guard.js";
import { Roles } from "../common/roles.decorator.js";
import { SystemRole, JobLogStatus } from "@prisma/client";
import { LogsService } from "./logs.service.js";

@Controller("logs")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SystemRole.ADMIN, SystemRole.SUPER_ADMIN)
export class LogsController {
  constructor(@Inject(LogsService) private readonly logsService: LogsService) {}

  @Get("scraper")
  async scraperLogs(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("status") status?: JobLogStatus,
    @Query("jobName") jobName?: string,
  ) {
    return this.logsService.findByType("SCRAPER", { page, limit, status, jobName });
  }

  @Get("embedding")
  async embeddingLogs(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("status") status?: JobLogStatus,
  ) {
    return this.logsService.findByType("EMBEDDING", { page, limit, status });
  }

  @Get("reports")
  async reportLogs(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("status") status?: JobLogStatus,
  ) {
    return this.logsService.findByType("REPORT", { page, limit, status });
  }

  @Get("stats")
  async stats() {
    return this.logsService.getStats();
  }

  @Get("reembed-progress")
  async reembedProgress() {
    return this.logsService.getReembedProgress();
  }

  @Get("token-stats")
  async tokenStats() {
    return this.logsService.getTokenStats();
  }
}
