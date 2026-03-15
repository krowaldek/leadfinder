import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Inject,
  Logger,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
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
  createProjectSchema,
  updateProjectSchema,
  createTopicSchema,
  updateTopicSchema,
  onboardRequestSchema,
  type PromptRequest,
  type UpdateMatchStatus,
  type UpdateClient,
  type CreateProject,
  type UpdateProject,
  type CreateTopic,
  type UpdateTopic,
  type OnboardRequest,
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
  /**
   * Public onboarding endpoint — no JWT required.
   * Accepts activity description + email, creates client + project + topic.
   */
  @Post("onboard")
  async onboard(
    @Body(new ZodValidationPipe(onboardRequestSchema)) body: OnboardRequest,
  ) {
    const result = await this.clientsService.onboard(body.activity, body.email);
    return result;
  }

  /** Legacy chat-based prompt endpoint — kept for backward compat */
  @Post("prompt")
  async prompt(
    @Body(new ZodValidationPipe(promptRequestSchema)) body: PromptRequest,
  ) {
    return this.promptService.processMessage(body.sessionId, body.message);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Get("all-projects")
  async getAllProjects(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.clientsService.findAllProjects(page, limit);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Get("all-topics")
  async getAllTopics(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.clientsService.findAllTopics(page, limit);
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
    const client = await this.clientsService.findOne(id);
    return { data: client };
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
    return { data: updated };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Post(":id/generate-topic-prompt")
  async generateTopicPrompt(
    @Param("id") clientId: string,
    @Body() body: { title?: string },
  ) {
    return this.clientsService.generateTopicPrompt(clientId, body.title ?? "");
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Post(":id/rematch")
  async rematch(@Param("id") id: string) {
    await this.clientsService.findOne(id);
    const result = await this.clientsService.enqueueMatching(id);
    return {
      message: result.topicEmbeddingsQueued > 0
        ? "Rematch initiated and missing topic embeddings queued"
        : "Rematch initiated",
      clientId: id,
      ...result,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Post("backfill")
  async backfill() {
    const result = await this.clientsService.backfillClients({ status: "ACTIVE" });
    return { message: "Client backfill queued", ...result };
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

  // ── Projects ──────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Get(":id/projects")
  async getProjects(@Param("id") clientId: string) {
    return this.clientsService.getProjects(clientId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Post(":id/projects")
  async createProject(
    @Param("id") clientId: string,
    @Body(new ZodValidationPipe(createProjectSchema)) body: CreateProject,
  ) {
    return this.clientsService.createProject(clientId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Patch(":id/projects/:projectId")
  async updateProject(
    @Param("id") clientId: string,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProject,
  ) {
    return this.clientsService.updateProject(clientId, projectId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(":id/projects/:projectId")
  async deleteProject(
    @Param("id") clientId: string,
    @Param("projectId") projectId: string,
  ) {
    await this.clientsService.deleteProject(clientId, projectId);
  }

  // ── Topics ────────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Get(":id/projects/:projectId/topics")
  async getTopics(
    @Param("id") clientId: string,
    @Param("projectId") projectId: string,
  ) {
    return this.clientsService.getTopics(clientId, projectId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Post(":id/projects/:projectId/topics")
  async createTopic(
    @Param("id") clientId: string,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(createTopicSchema)) body: CreateTopic,
  ) {
    return this.clientsService.createTopic(clientId, projectId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Patch(":id/projects/:projectId/topics/:topicId")
  async updateTopic(
    @Param("id") clientId: string,
    @Param("projectId") projectId: string,
    @Param("topicId") topicId: string,
    @Body(new ZodValidationPipe(updateTopicSchema)) body: UpdateTopic,
  ) {
    return this.clientsService.updateTopic(clientId, projectId, topicId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(":id/projects/:projectId/topics/:topicId")
  async deleteTopic(
    @Param("id") clientId: string,
    @Param("projectId") projectId: string,
    @Param("topicId") topicId: string,
  ) {
    await this.clientsService.deleteTopic(clientId, projectId, topicId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  @Post(":id/projects/:projectId/topics/:topicId/embed")
  async embedTopic(
    @Param("id") _clientId: string,
    @Param("projectId") _projectId: string,
    @Param("topicId") topicId: string,
  ) {
    await this.clientsService.enqueueTopicEmbedding(topicId);
    return { message: "Embedding queued", topicId };
  }
}
