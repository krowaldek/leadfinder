import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Inject,
  Logger,
  ParseIntPipe,
  DefaultValuePipe,
} from "@nestjs/common";
import { JwtAuthGuard } from "../common/jwt-auth.guard.js";
import { RolesGuard } from "../common/roles.guard.js";
import { Roles } from "../common/roles.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ClientsService } from "./clients.service.js";
import { ClientPromptService } from "./client-prompt.service.js";
import {
  promptRequestSchema,
  updateMatchStatusSchema,
  updateClientSchema,
  type PromptRequest,
  type UpdateMatchStatus,
  type UpdateClient,
} from "@leadfinder/contracts";

@Controller("clients")
export class ClientsController {
  private readonly logger = new Logger(ClientsController.name);

  constructor(
    @Inject(ClientsService) private readonly clientsService: ClientsService,
    @Inject(ClientPromptService)
    private readonly promptService: ClientPromptService,
  ) {}

  /**
   * Conversational endpoint — no auth required.
   * Admin panel sends JWT anyway; future portal users won't have one.
   * TODO: add user ownership when portal auth is implemented.
   */
  @Post("prompt")
  async prompt(
    @Body(new ZodValidationPipe(promptRequestSchema)) body: PromptRequest,
  ) {
    return this.promptService.processMessage(body.sessionId, body.message);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Get()
  async findAll(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.clientsService.findAll(page, limit);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Get(":id")
  async findOne(@Param("id") id: string) {
    return this.clientsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Get(":id/matches")
  async getMatches(@Param("id") id: string) {
    return this.clientsService.getMatches(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Patch(":id")
  async updateClient(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) body: UpdateClient,
  ) {
    const updated = await this.clientsService.updateClient(id, body);

    return { data: updated, rematch: "queued" };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Post(":id/rematch")
  async rematch(@Param("id") id: string) {
    // Validate client exists
    await this.clientsService.findOne(id);

    await this.clientsService.enqueueMatching(id);

    return { message: "Rematch initiated", clientId: id };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Post("backfill")
  async backfill() {
    const result = await this.clientsService.backfillClients({ status: "ACTIVE" });
    return {
      message: "Client backfill queued",
      ...result,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Patch(":id/matches/:matchId/status")
  async updateMatchStatus(
    @Param("id") clientId: string,
    @Param("matchId") matchId: string,
    @Body(new ZodValidationPipe(updateMatchStatusSchema)) body: UpdateMatchStatus,
  ) {
    return this.clientsService.updateMatchStatus(clientId, matchId, body.status);
  }
}
