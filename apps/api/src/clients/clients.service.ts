import { Injectable, Inject, Logger, NotFoundException } from "@nestjs/common";
import { ClientMatchingService } from "./client-matching.service.js";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";
import {
  buildTopicPromptFromProfile,
  parseTopicMatchingProfile,
  topicMatchingProfileSchema,
  type TopicMatchingProfile,
} from "@leadfinder/contracts";
import type {
  UpdateClient,
  CreateProject,
  UpdateProject,
  CreateTopic,
  UpdateTopic,
} from "@leadfinder/contracts";
import {
  CLIENT_MATCHING_QUEUE,
  ClientMatchingJob,
} from "./client-matching.constants.js";
import {
  EMBEDDING_QUEUE,
  EmbeddingJob,
} from "../embedding/embedding-queue.constants.js";

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnv>,
    @Inject(ClientMatchingService)
    private readonly clientMatchingService: ClientMatchingService,
    @InjectQueue(CLIENT_MATCHING_QUEUE)
    private readonly matchingQueue: Queue,
    @InjectQueue(EMBEDDING_QUEUE)
    private readonly embeddingQueue: Queue,
  ) {}

  async createClient(data: {
    companyName: string;
    industry: string;
    geographicScope: "NATIONAL" | "REGIONAL" | "LOCAL";
    geographicDetails?: string | null;
    budgetDescription: string;
    contactPersonName: string;
    contactPersonRole: string;
  }) {
    const client = await this.prisma.client.create({
      data: {
        companyName: data.companyName,
        industry: data.industry,
        geographicScope: data.geographicScope,
        geographicDetails: data.geographicDetails ?? null,
        budgetDescription: data.budgetDescription,
        contactPersonName: data.contactPersonName,
        contactPersonRole: data.contactPersonRole,
      },
    });

    this.logger.log(`Created client: ${client.companyName} (${client.id})`);
    return this.serializeClient(client, 0);
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          _count: { select: { projects: true } },
        },
      }),
      this.prisma.client.count(),
    ]);

    return {
      data: rows.map((c) => this.serializeClient(c, c._count.projects)),
      meta: {
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: { _count: { select: { projects: true } } },
    });
    if (!client) throw new NotFoundException("Client not found");
    return this.serializeClient(client, client._count.projects);
  }

  async getMatches(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    if (!client) throw new NotFoundException("Client not found");

    const matches = await this.prisma.clientMatch.findMany({
      where: {
        topic: { project: { clientId } },
      },
      include: {
        topic: {
          select: {
            id: true,
            title: true,
            project: { select: { id: true, name: true } },
          },
        },
        announcement: true,
      },
      orderBy: { similarity: "desc" },
    });

    return {
      data: matches.map((m) => {
        const announcement = m.announcement as typeof m.announcement & {
          aiTitle?: string | null;
          location?: string | null;
          contractingAuthority?: string | null;
        };
        const rawData = announcement.rawData as { orders?: unknown[] } | null;
        const ordersCount = Array.isArray(rawData?.orders) ? rawData.orders.length : 0;
        const isMultiPart =
          announcement.sourceSystem === "BAZA_KONKURENCYJNOSCI" && ordersCount > 1;

        return {
        id: m.id,
        topicId: m.topicId,
        announcementId: m.announcementId,
        similarity: m.similarity,
        status: m.status,
        topic: {
          id: m.topic.id,
          title: m.topic.title,
          projectId: m.topic.project.id,
          projectName: m.topic.project.name,
        },
        announcement: {
          id: announcement.id,
          partIndex: announcement.partIndex,
          title: announcement.title,
          aiTitle: announcement.aiTitle ?? null,
          displayTitle: announcement.aiTitle ?? announcement.title,
          description: announcement.description,
          url: announcement.url,
          sourceSystem: announcement.sourceSystem,
          externalId: announcement.externalId,
          kind: announcement.kind ?? null,
          searchContext: announcement.searchContext,
          llmEstimatedValue:
            announcement.llmEstimatedValue?.toString() ?? null,
          detailedReport: announcement.detailedReport ?? null,
          publishedAt: announcement.publishedAt?.toISOString() ?? null,
          deadlineAt: announcement.deadlineAt?.toISOString() ?? null,
          valueMin: announcement.valueMin?.toString() ?? null,
          valueMax: announcement.valueMax?.toString() ?? null,
          location: announcement.location ?? null,
          contractingAuthority: announcement.contractingAuthority ?? null,
          isMultiPart,
          displayPartNumber: isMultiPart ? announcement.partIndex + 1 : null,
        },
        createdAt: m.createdAt.toISOString(),
        };
      }),
      meta: { total: matches.length },
    };
  }

  async getTopicMatchingDebug(
    clientId: string,
    projectId: string,
    topicId: string,
  ) {
    const topic = await this.prisma.topic.findFirst({
      where: { id: topicId, projectId, project: { clientId } },
      select: {
        id: true,
        title: true,
        prompt: true,
        embeddingStatus: true,
        negativeKeywords: true,
        project: {
          select: {
            id: true,
            name: true,
            client: { select: { id: true, companyName: true } },
          },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException("Topic not found");
    }

    const pipelineDebug = await this.clientMatchingService.buildTopicMatchingDebugReport(topicId);

    const matches = await this.prisma.clientMatch.findMany({
      where: { topicId },
      include: {
        announcement: {
          select: {
            id: true,
            title: true,
            description: true,
            url: true,
            sourceSystem: true,
            externalId: true,
            partIndex: true,
            kind: true,
            searchContext: true,
            detailedReport: true,
            llmEstimatedValue: true,
            publishedAt: true,
            deadlineAt: true,
            valueMin: true,
            valueMax: true,
          },
        },
      },
      orderBy: { similarity: "desc" },
    });

    const parsedMatches = matches.map((match) => ({
      id: match.id,
      similarity: match.similarity,
      status: match.status,
      createdAt: match.createdAt.toISOString(),
      updatedAt: match.updatedAt.toISOString(),
      announcement: {
        id: match.announcement.id,
        title: match.announcement.title,
        description: match.announcement.description,
        url: match.announcement.url,
        sourceSystem: match.announcement.sourceSystem,
        externalId: match.announcement.externalId,
        partIndex: match.announcement.partIndex,
        kind: match.announcement.kind ?? null,
        searchContext: match.announcement.searchContext,
        detailedReport: match.announcement.detailedReport ?? null,
        llmEstimatedValue: match.announcement.llmEstimatedValue?.toString() ?? null,
        publishedAt: match.announcement.publishedAt?.toISOString() ?? null,
        deadlineAt: match.announcement.deadlineAt?.toISOString() ?? null,
        valueMin: match.announcement.valueMin?.toString() ?? null,
        valueMax: match.announcement.valueMax?.toString() ?? null,
      },
    }));

    const candidateAnnouncementIds = pipelineDebug?.candidates.map((candidate) => candidate.announcementId) ?? [];

    const candidateAnnouncements = candidateAnnouncementIds.length > 0
      ? await this.prisma.announcement.findMany({
        where: {
          id: { in: candidateAnnouncementIds },
        },
        select: {
          id: true,
          description: true,
          searchContext: true,
          detailedReport: true,
        },
      })
      : [];

    const announcementLookup = new Map(
      candidateAnnouncements.map((announcement) => [
        announcement.id,
        {
          description: announcement.description,
          searchContext: announcement.searchContext,
          detailedReport: announcement.detailedReport,
        },
      ]),
    );

    const rawVectorHits = pipelineDebug?.candidates.map((candidate) => {
      const announcementText = announcementLookup.get(candidate.announcementId);

      return {
        announcementId: candidate.announcementId,
        title: candidate.title,
        semantic: candidate.semantic,
        keyword: candidate.keyword,
        domain: candidate.domain,
        hybrid: candidate.hybrid,
        rerank: candidate.rerank,
        final: candidate.final,
        stage: candidate.keptAfterRerank
          ? "FINAL"
          : candidate.sentToRerank
            ? "RERANKED"
            : candidate.keptAfterFilters
              ? "PRE_RERANK"
              : candidate.keyword > 0 || candidate.domain > 0
                ? "MERGED"
                : "VECTOR",
        keptAfterFilters: candidate.keptAfterFilters,
        sentToRerank: candidate.sentToRerank,
        keptAfterRerank: candidate.keptAfterRerank,
        negativePenaltyApplied: candidate.negativePenaltyApplied,
        rejectionReasons: candidate.rejectionReasons,
        rerankReason: candidate.rerankReason ?? null,
        mustHaveSatisfied: candidate.mustHaveSatisfied ?? null,
        excludeTriggered: candidate.excludeTriggered ?? null,
        kindFit: candidate.kindFit ?? null,
        topicCentrality: candidate.topicCentrality ?? null,
        scopeType: candidate.scopeType ?? null,
        announcementVectorText:
          announcementText?.detailedReport
          ?? announcementText?.searchContext
          ?? announcementText?.description
          ?? null,
      };
    }) ?? [];

    const vectorCandidates = rawVectorHits;

    return {
      data: {
        topic: {
          id: topic.id,
          title: topic.title,
          prompt: topic.prompt,
          embeddingStatus: topic.embeddingStatus,
          negativeKeywords: topic.negativeKeywords,
          vectorText: topic.prompt,
          project: {
            id: topic.project.id,
            name: topic.project.name,
          },
          client: {
            id: topic.project.client.id,
            companyName: topic.project.client.companyName,
          },
        },
        summary: {
          storedMatches: parsedMatches.length,
          vectorCandidates: pipelineDebug?.counts.vector ?? vectorCandidates.length,
          rerankCandidates:
            pipelineDebug?.counts.preRerank
            ?? vectorCandidates.filter((candidate) => candidate.keptAfterFilters).length,
          reranked:
            pipelineDebug?.counts.rerankWindow
            ?? vectorCandidates.filter((candidate) => candidate.sentToRerank).length,
          shortlisted: parsedMatches.filter((match) => match.status === "SHORTLISTED").length,
          dismissed: parsedMatches.filter((match) => match.status === "DISMISSED").length,
        },
        rawVectorHits,
        vectorCandidates,
        finalMatches: parsedMatches,
      },
    };
  }

  async updateMatchStatus(clientId: string, matchId: string, status: string) {
    const match = await this.prisma.clientMatch.findFirst({
      where: {
        id: matchId,
        topic: { project: { clientId } },
      },
    });
    if (!match) throw new NotFoundException("Match not found");

    return this.prisma.clientMatch.update({
      where: { id: matchId },
      data: { status: status as never },
    });
  }

  // ── Project CRUD ──────────────────────────────────────────────────────────

  async createProject(clientId: string, data: CreateProject) {
    await this.findOne(clientId); // ensures client exists
    const project = await this.prisma.project.create({
      data: {
        clientId,
        name: data.name,
        description: data.description ?? null,
      },
      include: { _count: { select: { topics: true } } },
    });
    return { data: this.serializeProject(project) };
  }

  async getProjects(clientId: string) {
    await this.findOne(clientId);
    const rows = await this.prisma.project.findMany({
      where: { clientId },
      include: { _count: { select: { topics: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { data: rows.map((p) => this.serializeProject(p)) };
  }

  async updateProject(
    clientId: string,
    projectId: string,
    data: UpdateProject,
  ) {
    const existing = await this.prisma.project.findFirst({
      where: { id: projectId, clientId },
    });
    if (!existing) throw new NotFoundException("Project not found");
    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
      },
      include: { _count: { select: { topics: true } } },
    });
    return { data: this.serializeProject(project) };
  }

  async deleteProject(clientId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, clientId },
    });
    if (!project) throw new NotFoundException("Project not found");
    await this.prisma.project.delete({ where: { id: projectId } });
  }

  // ── Topic CRUD ────────────────────────────────────────────────────────────

  async createTopic(clientId: string, projectId: string, data: CreateTopic) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, clientId },
    });
    if (!project) throw new NotFoundException("Project not found");

    const prepared = this.prepareTopicPayload(
      data.prompt,
      data.negativeKeywords ?? [],
      data.matchingProfile,
    );

    const topic = await this.prisma.topic.create({
      data: {
        projectId,
        title: data.title,
        prompt: prepared.prompt,
        negativeKeywords: prepared.negativeKeywords,
        embeddingStatus: "PENDING",
      },
      include: { _count: { select: { matches: true } } },
    });
    await this.enqueueTopicEmbedding(topic.id);
    return { data: this.serializeTopic(topic) };
  }

  async updateTopic(
    clientId: string,
    projectId: string,
    topicId: string,
    data: UpdateTopic,
  ) {
    const topic = await this.prisma.topic.findFirst({
      where: { id: topicId, projectId, project: { clientId } },
    });
    if (!topic) throw new NotFoundException("Topic not found");

    const nextPrompt = data.prompt ?? topic.prompt;
    const nextNegativeKeywords =
      data.negativeKeywords ?? topic.negativeKeywords;
    const nextProfile =
      data.matchingProfile ??
      parseTopicMatchingProfile(topic.prompt, topic.negativeKeywords);
    const prepared = this.prepareTopicPayload(
      nextPrompt,
      nextNegativeKeywords,
      nextProfile,
    );

    const promptChanged = prepared.prompt !== topic.prompt;
    const titleChanged = data.title !== undefined && data.title !== topic.title;
    const embeddingInputChanged = promptChanged || titleChanged;

    const updated = await this.prisma.topic.update({
      where: { id: topicId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.prompt !== undefined || data.matchingProfile !== undefined
          ? { prompt: prepared.prompt }
          : {}),
        ...(data.negativeKeywords !== undefined ||
        data.matchingProfile !== undefined
          ? { negativeKeywords: prepared.negativeKeywords }
          : {}),
        ...(embeddingInputChanged && { embeddingStatus: "PENDING" }),
      },
      include: { _count: { select: { matches: true } } },
    });

    if (embeddingInputChanged) {
      await this.enqueueTopicEmbedding(updated.id);
    }

    return { data: this.serializeTopic(updated) };
  }

  async deleteTopic(clientId: string, projectId: string, topicId: string) {
    const topic = await this.prisma.topic.findFirst({
      where: { id: topicId, projectId, project: { clientId } },
    });
    if (!topic) throw new NotFoundException("Topic not found");
    await this.prisma.topic.delete({ where: { id: topicId } });
  }

  async getTopics(clientId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, clientId },
    });
    if (!project) throw new NotFoundException("Project not found");

    const rows = await this.prisma.topic.findMany({
      where: { projectId },
      include: { _count: { select: { matches: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { data: rows.map((t) => this.serializeTopic(t)) };
  }

  // ── Matching helpers ──────────────────────────────────────────────────────

  async enqueueTopicEmbedding(topicId: string): Promise<void> {
    await this.embeddingQueue.add(
      EmbeddingJob.EMBED_TOPIC,
      { topicId },
      {
        jobId: `topic-embed-${topicId}-${Date.now()}`,
        priority: 1,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 10 },
      },
    );
    this.logger.log(`Queued embedding for topic: ${topicId}`);
  }

  async enqueueMatching(clientId: string): Promise<{
    matchingQueued: boolean;
    topicEmbeddingsQueued: number;
    embeddedTopics: number;
    pendingTopics: number;
  }> {
    const topics = await this.prisma.topic.findMany({
      where: {
        project: { clientId },
      },
      select: {
        id: true,
        embeddingStatus: true,
      },
    });

    const embeddedTopics = topics.filter((topic) => topic.embeddingStatus === "EMBEDDED");
    const topicsNeedingEmbedding = topics.filter(
      (topic) => topic.embeddingStatus !== "EMBEDDED",
    );

    for (const topic of topicsNeedingEmbedding) {
      await this.enqueueTopicEmbedding(topic.id);
    }

    if (embeddedTopics.length > 0) {
      await this.matchingQueue.add(
        ClientMatchingJob.MATCH_CLIENT,
        { clientId },
        {
          jobId: `client-match-${clientId}-${Date.now()}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { count: 20 },
          removeOnFail: { count: 10 },
        },
      );
    }

    this.logger.log(
      `Queued rematch for client ${clientId}: embeddedTopics=${embeddedTopics.length}, topicEmbeddingsQueued=${topicsNeedingEmbedding.length}`,
    );

    return {
      matchingQueued: embeddedTopics.length > 0,
      topicEmbeddingsQueued: topicsNeedingEmbedding.length,
      embeddedTopics: embeddedTopics.length,
      pendingTopics: topicsNeedingEmbedding.length,
    };
  }

  async backfillClients(options?: { status?: "ACTIVE" | "INACTIVE" }): Promise<{
    queued: number;
    total: number;
    status: "ACTIVE" | "INACTIVE" | "ALL";
  }> {
    const filterStatus = options?.status;
    const clients = await this.prisma.client.findMany({
      where: filterStatus ? { status: filterStatus } : undefined,
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    for (const client of clients) {
      await this.enqueueMatching(client.id);
    }

    this.logger.log(
      `Backfill queued for ${clients.length} client(s) with status=${filterStatus ?? "ALL"}`,
    );

    return {
      queued: clients.length,
      total: clients.length,
      status: filterStatus ?? "ALL",
    };
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  private serializeProject(project: {
    id: string;
    clientId: string;
    name: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    _count: { topics: number };
  }) {
    return {
      id: project.id,
      clientId: project.clientId,
      name: project.name,
      description: project.description,
      topicCount: project._count.topics,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }

  private serializeTopic(topic: {
    id: string;
    projectId: string;
    title: string;
    prompt: string;
    embeddingStatus: string;
    negativeKeywords: string[];
    createdAt: Date;
    updatedAt: Date;
    _count: { matches: number };
  }) {
    const matchingProfile = parseTopicMatchingProfile(
      topic.prompt,
      topic.negativeKeywords,
    );
    return {
      id: topic.id,
      projectId: topic.projectId,
      title: topic.title,
      prompt: matchingProfile?.summary ?? topic.prompt,
      matchingProfile: matchingProfile ?? undefined,
      embeddingStatus: topic.embeddingStatus as
        | "PENDING"
        | "EMBEDDED"
        | "ERROR",
      negativeKeywords: topic.negativeKeywords,
      matchCount: topic._count.matches,
      createdAt: topic.createdAt.toISOString(),
      updatedAt: topic.updatedAt.toISOString(),
    };
  }

  serializeClient(
    client: {
      id: string;
      companyName: string;
      industry: string;
      geographicScope: string;
      geographicDetails: string | null;
      budgetDescription: string;
      contactPersonName: string;
      contactPersonRole: string;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    },
    projectCount: number,
  ) {
    return {
      id: client.id,
      companyName: client.companyName,
      industry: client.industry,
      geographicScope: client.geographicScope as
        | "NATIONAL"
        | "REGIONAL"
        | "LOCAL",
      geographicDetails: client.geographicDetails,
      budgetDescription: client.budgetDescription,
      contactPersonName: client.contactPersonName,
      contactPersonRole: client.contactPersonRole,
      status: client.status as "ACTIVE" | "INACTIVE",
      projectCount,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
    };
  }

  // ── Onboarding ────────────────────────────────────────────────────────────

  async onboard(activity: string, email: string) {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    const model = this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-5.4-nano";

    // Derive sensible defaults from email
    const [localPart, domain] = email.split("@");
    const domainName = (domain ?? "").replace(/\.(pl|com|org|net|eu|io)$/, "");
    const defaultCompanyName = domainName
      ? domainName.charAt(0).toUpperCase() + domainName.slice(1)
      : "Nowy klient";
    const defaultContactName =
      (localPart ?? "")
        .replace(/[._-]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim() || "Nieznany";

    let companyName = defaultCompanyName;
    let industry = activity.slice(0, 120);
    let topicTitle = activity.slice(0, 100);
    let topicProfile: TopicMatchingProfile = topicMatchingProfileSchema.parse({
      summary:
        activity.length >= 10 ? activity : `Zamówienia związane z: ${activity}`,
      mustHave: [],
      niceToHave: [],
      exclude: [],
      expectedKinds: [],
    });

    // Try LLM extraction (graceful degradation if no key)
    if (apiKey) {
      try {
        const llm = new ChatOpenAI({
          apiKey,
          model,
          temperature: 0,
          modelKwargs: { response_format: { type: "json_object" } },
        });

        const result = await llm.invoke([
          new SystemMessage(`Jesteś ekspertem od zamówień publicznych w Polsce. Analizujesz opis działalności lub potrzeby klienta i generujesz profil do automatycznego dopasowywania ogłoszeń przetargowych.

Odpowiedz WYŁĄCZNIE jako obiekt JSON (bez markdown, bez żadnego dodatkowego tekstu):
{
  "companyName": "Krótka nazwa firmy lub branży (jeśli brak danych — null)",
  "industry": "Branża i specjalizacja firmy (1-2 zdania)",
  "topicTitle": "Zwięzły tytuł szukanego rodzaju zamówień (max 80 znaków)",
  "topicProfile": {
    "summary": "BARDZO ROZBUDOWANY opis wyszukiwania — MINIMUM 300 ZNAKÓW. Ma opisywać dokładnie czego klient szuka i w jakim kontekście.",
    "mustHave": ["2-6 najważniejszych fraz, które MUSZĄ wystąpić branżowo"],
    "niceToHave": ["frazy dodatkowe, mile widziane"],
    "exclude": ["frazy wykluczające złe dopasowania"],
    "expectedKinds": ["DOSTAWA | USLUGA | ROBOTY_BUDOWLANE | SZKOLENIE | USLUGA_IT | USLUGA_BADAWCZO_ROZWOJOWA | DORADZTWO | INNE"]
  }
}

Zasady:
- mustHave to rdzeń branży i zakresu, bez ogólników typu "usługa" czy "obsługa"
- niceToHave to dodatki i powiązane frazy
- exclude ma eliminować typowe pomyłki i sąsiednie, ale błędne branże
- expectedKinds wybierz tylko realne typy zamówień dla klienta`),
          new HumanMessage(
            `Opis działalności/czego szukam: ${activity}\nEmail: ${email}`,
          ),
        ]);

        const parsed = JSON.parse(result.content as string) as {
          companyName?: string | null;
          industry?: string | null;
          topicTitle?: string | null;
          topicProfile?: TopicMatchingProfile | null;
        };

        if (parsed.companyName) companyName = parsed.companyName;
        if (parsed.industry) industry = parsed.industry;
        if (parsed.topicTitle) topicTitle = parsed.topicTitle;
        if (parsed.topicProfile) {
          topicProfile = topicMatchingProfileSchema.parse(parsed.topicProfile);
        }
      } catch (err) {
        this.logger.warn(
          "Onboard LLM extraction failed, using defaults",
          (err as Error).message,
        );
      }
    }

    // Create client
    const client = await this.prisma.client.create({
      data: {
        companyName,
        industry,
        geographicScope: "NATIONAL",
        budgetDescription: "Nie określono",
        contactPersonName: defaultContactName,
        contactPersonRole: "Właściciel",
      },
    });

    // Create default project
    const project = await this.prisma.project.create({
      data: { clientId: client.id, name: "Projekt główny" },
      include: { _count: { select: { topics: true } } },
    });

    // Create topic from activity
    const topic = await this.prisma.topic.create({
      data: {
        projectId: project.id,
        title: topicTitle,
        prompt: buildTopicPromptFromProfile(topicProfile),
        negativeKeywords: topicProfile.exclude,
      },
      include: { _count: { select: { matches: true } } },
    });

    // Queue embedding and matching
    await this.enqueueTopicEmbedding(topic.id);

    this.logger.log(
      `Onboarded client: ${client.companyName} (${client.id}), topic: ${topic.title}`,
    );

    return {
      client: this.serializeClient(client, 1),
      projectId: project.id,
      topicId: topic.id,
    };
  }

  // ── Generate topic prompt via LLM ─────────────────────────────────────────

  async generateTopicPrompt(
    clientId: string,
    title: string,
  ): Promise<{ prompt: string; matchingProfile: TopicMatchingProfile }> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { companyName: true, industry: true },
    });

    const context = client
      ? `Firma: ${client.companyName}. Branża: ${client.industry}`
      : "";

    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      const fallbackProfile = topicMatchingProfileSchema.parse({
        summary: `Firma poszukuje zamówień związanych z: ${title}. Uzupełnij dokładnie czego szukasz, jakie elementy są obowiązkowe, a jakie powinny być wykluczone.`,
        mustHave: [title],
        niceToHave: [],
        exclude: [],
        expectedKinds: [],
      });
      return {
        prompt: fallbackProfile.summary,
        matchingProfile: fallbackProfile,
      };
    }

    const model = this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-5.4-nano";
    const llm = new ChatOpenAI({
      apiKey,
      model,
      ...(model.startsWith("gpt-5") ? {} : { temperature: 0.3 }),
      modelKwargs: { response_format: { type: "json_object" } },
    });

    const result = await llm.invoke([
      new SystemMessage(`Jesteś ekspertem od zamówień publicznych w Polsce. Generujesz STRUKTURALNY profil tematu wyszukiwania ogłoszeń przetargowych.

Odpowiedz WYŁĄCZNIE jako obiekt JSON (bez markdown):
{
  "matchingProfile": {
    "summary": "min. 300 znaków, konkretny opis zakresu",
    "mustHave": ["frazy obowiązkowe"],
    "niceToHave": ["frazy dodatkowe"],
    "exclude": ["frazy wykluczające"],
    "expectedKinds": ["DOSTAWA | USLUGA | ROBOTY_BUDOWLANE | SZKOLENIE | USLUGA_IT | USLUGA_BADAWCZO_ROZWOJOWA | DORADZTWO | INNE"]
  }
}

Zasady:
- mustHave: rdzeń branży i zakresu, 2-6 pozycji
- niceToHave: frazy pomocnicze i pokrewne, 0-8 pozycji
- exclude: typowe błędne sąsiednie branże lub fałszywe skojarzenia, 0-8 pozycji
- expectedKinds: tylko realne typy zamówień
- unikaj ogólników typu "obsługa", "usługa", "pracownicy", jeśli nie są istotą tematu`),
      new HumanMessage(
        `${context ? context + "\n" : ""}Temat wyszukiwania: ${title}`,
      ),
    ]);

    const parsed = JSON.parse(result.content as string) as {
      matchingProfile?: TopicMatchingProfile;
    };
    const matchingProfile = topicMatchingProfileSchema.parse(
      parsed.matchingProfile ?? {
        summary: `Zamówienia związane z: ${title}`,
        mustHave: [title],
        niceToHave: [],
        exclude: [],
        expectedKinds: [],
      },
    );
    return { prompt: matchingProfile.summary, matchingProfile };
  }

  private prepareTopicPayload(
    prompt: string,
    negativeKeywords: string[],
    matchingProfile?: TopicMatchingProfile | null,
  ) {
    const profile = matchingProfile
      ? topicMatchingProfileSchema.parse({
          ...matchingProfile,
          exclude:
            matchingProfile.exclude.length > 0
              ? matchingProfile.exclude
              : negativeKeywords,
        })
      : null;

    const storedNegativeKeywords = profile?.exclude ?? [
      ...new Set(negativeKeywords.map((v) => v.trim()).filter(Boolean)),
    ];
    const storedPrompt = profile
      ? buildTopicPromptFromProfile(profile)
      : prompt.trim();

    return {
      prompt: storedPrompt,
      negativeKeywords: storedNegativeKeywords,
      matchingProfile: profile,
    };
  }

  // ── Global listings ───────────────────────────────────────────────────────

  async findAllProjects(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.prisma.project.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { topics: true } },
          client: { select: { companyName: true } },
        },
      }),
      this.prisma.project.count(),
    ]);

    return {
      data: rows.map((p) => ({
        ...this.serializeProject(p),
        clientName: p.client.companyName,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findAllTopics(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.prisma.topic.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { matches: true } },
          project: {
            select: {
              name: true,
              clientId: true,
              client: { select: { companyName: true } },
            },
          },
        },
      }),
      this.prisma.topic.count(),
    ]);

    return {
      data: rows.map((t) => ({
        ...this.serializeTopic(t),
        projectName: t.project.name,
        clientId: t.project.clientId,
        clientName: t.project.client.companyName,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async updateClient(id: string, data: UpdateClient) {
    const existing = await this.prisma.client.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Client not found");

    const updated = await this.prisma.client.update({
      where: { id },
      data: {
        ...(data.companyName !== undefined && {
          companyName: data.companyName,
        }),
        ...(data.industry !== undefined && { industry: data.industry }),
        ...(data.geographicScope !== undefined && {
          geographicScope: data.geographicScope,
        }),
        ...(data.geographicDetails !== undefined && {
          geographicDetails: data.geographicDetails,
        }),
        ...(data.budgetDescription !== undefined && {
          budgetDescription: data.budgetDescription,
        }),
        ...(data.contactPersonName !== undefined && {
          contactPersonName: data.contactPersonName,
        }),
        ...(data.contactPersonRole !== undefined && {
          contactPersonRole: data.contactPersonRole,
        }),
      },
    });

    this.logger.log(`Updated client: ${updated.companyName} (${updated.id})`);
    await this.enqueueMatching(updated.id);

    const projectCount = await this.prisma.project.count({
      where: { clientId: id },
    });
    return this.serializeClient(updated, projectCount);
  }
}
