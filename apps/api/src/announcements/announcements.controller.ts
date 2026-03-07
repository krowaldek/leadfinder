import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import {
  AnnouncementsListQuery,
  announcementsListQuerySchema,
} from "@leadfinder/contracts";
import { AnnouncementsService } from "./announcements.service.js";
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
}
