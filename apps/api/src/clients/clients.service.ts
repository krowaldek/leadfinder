import { Injectable, Inject, Logger, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";
import type { UpdateClient, CreateProject, UpdateProject, CreateTopic, UpdateTopic } from "@leadfinder/contracts";
import { CLIENT_MATCHING_QUEUE, ClientMatchingJob } from "./client-matching.constants.js";
import { EMBEDDING_QUEUE, EmbeddingJob } from "../embedding/embedding-queue.constants.js";

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnv>,
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
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
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
        announcement: {
          select: {
            id: true,
            partIndex: true,
            title: true,
            description: true,
            url: true,
            sourceSystem: true,
            externalId: true,
            kind: true,
            searchContext: true,
            llmEstimatedValue: true,
            detailedReport: true,
            publishedAt: true,
            deadlineAt: true,
            valueMin: true,
            valueMax: true,
          },
        },
      },
      orderBy: { similarity: "desc" },
    });

    return {
      data: matches.map((m) => ({
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
          id: m.announcement.id,
          partIndex: m.announcement.partIndex,
          title: m.announcement.title,
          description: m.announcement.description,
          url: m.announcement.url,
          sourceSystem: m.announcement.sourceSystem,
          externalId: m.announcement.externalId,
          kind: m.announcement.kind ?? null,
          searchContext: m.announcement.searchContext,
          llmEstimatedValue: m.announcement.llmEstimatedValue?.toString() ?? null,
          detailedReport: m.announcement.detailedReport ?? null,
          publishedAt: m.announcement.publishedAt?.toISOString() ?? null,
          deadlineAt: m.announcement.deadlineAt?.toISOString() ?? null,
          valueMin: m.announcement.valueMin?.toString() ?? null,
          valueMax: m.announcement.valueMax?.toString() ?? null,
        },
        createdAt: m.createdAt.toISOString(),
      })),
      meta: { total: matches.length },
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

  async updateProject(clientId: string, projectId: string, data: UpdateProject) {
    const existing = await this.prisma.project.findFirst({
      where: { id: projectId, clientId },
    });
    if (!existing) throw new NotFoundException("Project not found");
    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
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

    const topic = await this.prisma.topic.create({
      data: {
        projectId,
        title: data.title,
        prompt: data.prompt,
        negativeKeywords: data.negativeKeywords ?? [],
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

    const promptChanged =
      data.prompt !== undefined && data.prompt !== topic.prompt;

    const updated = await this.prisma.topic.update({
      where: { id: topicId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.prompt !== undefined && { prompt: data.prompt }),
        ...(data.negativeKeywords !== undefined && {
          negativeKeywords: data.negativeKeywords,
        }),
        // Reset embedding when prompt changes so it gets re-embedded
        ...(promptChanged && { embeddingStatus: "PENDING" }),
      },
      include: { _count: { select: { matches: true } } },
    });

    if (promptChanged) {
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
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 10 },
      },
    );
    this.logger.log(`Queued embedding for topic: ${topicId}`);
  }

  async enqueueMatching(clientId: string): Promise<void> {
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
    return {
      id: topic.id,
      projectId: topic.projectId,
      title: topic.title,
      prompt: topic.prompt,
      embeddingStatus: topic.embeddingStatus as "PENDING" | "EMBEDDED" | "ERROR",
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
      geographicScope: client.geographicScope as "NATIONAL" | "REGIONAL" | "LOCAL",
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
    const model = this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini";

    // Derive sensible defaults from email
    const [localPart, domain] = email.split("@");
    const domainName = (domain ?? "").replace(/\.(pl|com|org|net|eu|io)$/, "");
    const defaultCompanyName = domainName
      ? domainName.charAt(0).toUpperCase() + domainName.slice(1)
      : "Nowy klient";
    const defaultContactName = (localPart ?? "")
      .replace(/[._-]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || "Nieznany";

    let companyName = defaultCompanyName;
    let industry = activity.slice(0, 120);
    let topicTitle = activity.slice(0, 100);
    let topicPrompt = activity;

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
  "topicPrompt": "BARDZO ROZBUDOWANY opis wyszukiwania — MINIMUM 500 ZNAKÓW. Pisz ciągłym, bogatym tekstem jak opis zakresu zamówienia w przetargu. Zawrzyj: (1) dokładne nazwy szukanych usług/towarów/robót budowlanych, (2) wszystkie synonimy i alternatywne sformułowania, (3) typowe frazy z ogłoszeń przetargowych (np. dostawa, świadczenie usług, wykonanie, wdrożenie, serwis, obsługa, szkolenie, modernizacja, remont, budowa), (4) powiązane kategorie, specjalizacje i branże, (5) kontekst i cel zamówień. Im więcej słów kluczowych i wariantów terminologicznych — tym lepsze dopasowanie do ogłoszeń."
}

PRZYKŁAD dobrego topicPrompt dla firmy IT: "Firma świadczy usługi informatyczne, wdrożeniowe i integracyjne. Szuka zamówień na: dostawę oprogramowania, licencji i systemów IT, wdrożenie systemów ERP, CRM, HRM i systemów dziedzinowych, rozwiązania chmurowe, usługi programistyczne, tworzenie i utrzymanie aplikacji webowych i mobilnych, usługi hostingowe i infrastruktury IT, dostawę sprzętu komputerowego, serwerów i urządzeń sieciowych, serwis i wsparcie techniczne, helpdesk, utrzymanie systemów informatycznych, cyberbezpieczeństwo, audyty bezpieczeństwa IT, szkolenia informatyczne, digitalizacja procesów, transformacja cyfrowa."

WAŻNE: topicPrompt musi być tak bogaty semantycznie, żeby pokrywał wiele różnych wariantów ogłoszeń z tej branży. Każde słowo kluczowe zwiększa szanse na dopasowanie.`),
          new HumanMessage(`Opis działalności/czego szukam: ${activity}\nEmail: ${email}`),
        ]);

        const parsed = JSON.parse(result.content as string) as {
          companyName?: string | null;
          industry?: string | null;
          topicTitle?: string | null;
          topicPrompt?: string | null;
        };

        if (parsed.companyName) companyName = parsed.companyName;
        if (parsed.industry) industry = parsed.industry;
        if (parsed.topicTitle) topicTitle = parsed.topicTitle;
        if (parsed.topicPrompt) topicPrompt = parsed.topicPrompt;
      } catch (err) {
        this.logger.warn("Onboard LLM extraction failed, using defaults", (err as Error).message);
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
        prompt: topicPrompt,
        negativeKeywords: [],
      },
      include: { _count: { select: { matches: true } } },
    });

    // Queue embedding and matching
    await this.enqueueTopicEmbedding(topic.id);

    this.logger.log(`Onboarded client: ${client.companyName} (${client.id}), topic: ${topic.title}`);

    return {
      client: this.serializeClient(client, 1),
      projectId: project.id,
      topicId: topic.id,
    };
  }

  // ── Generate topic prompt via LLM ─────────────────────────────────────────

  async generateTopicPrompt(clientId: string, title: string): Promise<{ prompt: string }> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { companyName: true, industry: true },
    });

    const context = client
      ? `Firma: ${client.companyName}. Branża: ${client.industry}`
      : "";

    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      return {
        prompt: `Firma poszukuje zamówień związanych z: ${title}. Proszę uzupełnić szczegółowy opis ręcznie.`,
      };
    }

    const model = this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini";
    const llm = new ChatOpenAI({
      apiKey,
      model,
      temperature: 0.3,
      modelKwargs: { response_format: { type: "json_object" } },
    });

    const result = await llm.invoke([
      new SystemMessage(`Jesteś ekspertem od zamówień publicznych w Polsce. Generujesz opis tematu wyszukiwania ogłoszeń przetargowych.

Odpowiedz WYŁĄCZNIE jako obiekt JSON (bez markdown): { "prompt": "..." }

Wygeneruj BARDZO ROZBUDOWANY opis wyszukiwania — MINIMUM 500 ZNAKÓW. Pisz ciągłym, bogatym tekstem jak opis zakresu zamówienia w przetargu. Zawrzyj:
(1) dokładne nazwy szukanych usług/towarów/robót budowlanych,
(2) wszystkie synonimy i alternatywne sformułowania,
(3) typowe frazy z ogłoszeń przetargowych (dostawa, świadczenie usług, wykonanie, wdrożenie, serwis, obsługa, szkolenie, modernizacja, remont, budowa itd.),
(4) powiązane kategorie, specjalizacje i branże,
(5) kontekst i cel zamówień.
Im więcej słów kluczowych i wariantów terminologicznych — tym lepsze dopasowanie do ogłoszeń.`),
      new HumanMessage(`${context ? context + "\n" : ""}Temat wyszukiwania: ${title}`),
    ]);

    const parsed = JSON.parse(result.content as string) as { prompt?: string };
    return { prompt: parsed.prompt ?? `Zamówienia związane z: ${title}` };
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
            select: { name: true, clientId: true, client: { select: { companyName: true } } },
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
        ...(data.companyName !== undefined && { companyName: data.companyName }),
        ...(data.industry !== undefined && { industry: data.industry }),
        ...(data.geographicScope !== undefined && { geographicScope: data.geographicScope }),
        ...(data.geographicDetails !== undefined && { geographicDetails: data.geographicDetails }),
        ...(data.budgetDescription !== undefined && { budgetDescription: data.budgetDescription }),
        ...(data.contactPersonName !== undefined && { contactPersonName: data.contactPersonName }),
        ...(data.contactPersonRole !== undefined && { contactPersonRole: data.contactPersonRole }),
      },
    });

    this.logger.log(`Updated client: ${updated.companyName} (${updated.id})`);
    await this.enqueueMatching(updated.id);

    const projectCount = await this.prisma.project.count({ where: { clientId: id } });
    return this.serializeClient(updated, projectCount);
  }
}
