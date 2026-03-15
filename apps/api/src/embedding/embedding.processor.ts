import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import { EmbeddingService } from "./embedding.service.js";
import { EMBEDDING_QUEUE, EmbeddingJob } from "./embedding-queue.constants.js";
import { JobLoggerService } from "../logs/job-logger.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { ClientMatchingService } from "../clients/client-matching.service.js";
import type { AppEnv } from "../config/env.js";
import { buildAiOperationLog } from "../common/ai-usage.js";
import { getEmbeddingModel, getEmbeddingProvider } from "../common/embeddings.js";

interface EmbedAnnouncementPayload {
  announcementId: string;
}

interface EmbedTopicPayload {
  topicId: string;
}

const EMBEDDING_WORKER_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.EMBEDDING_WORKER_CONCURRENCY ?? "6", 10) || 6,
);

@Processor(EMBEDDING_QUEUE, { concurrency: EMBEDDING_WORKER_CONCURRENCY })
export class EmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbeddingProcessor.name);

  constructor(
    @Inject(EmbeddingService)
    private readonly embeddingService: EmbeddingService,
    @Inject(ClientMatchingService)
    private readonly matchingService: ClientMatchingService,
    @Inject(JobLoggerService)
    private readonly jobLogger: JobLoggerService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppEnv>,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const payload = job.data as EmbedAnnouncementPayload & EmbedTopicPayload;

    // ── EMBED_ANNOUNCEMENT ───────────────────────────────────────────────────
    if (job.name === EmbeddingJob.EMBED_ANNOUNCEMENT) {
      const { announcementId } = payload;
      this.logger.debug(`Processing EMBED_ANNOUNCEMENT for ${announcementId}`);

      const meta = await this.prisma.announcement.findUnique({
        where: { id: announcementId },
        select: { title: true, sourceSystem: true, externalId: true },
      });

      const entityTitle = meta
        ? `[${meta.sourceSystem}] ${meta.title}`
        : announcementId;

      const logId = await this.jobLogger.start({
        type: "EMBEDDING",
        jobId: job.id,
        jobName: job.name,
        entityId: announcementId,
        entityTitle,
        payload: {
          announcementId,
          source: meta?.sourceSystem ?? null,
          externalId: meta?.externalId ?? null,
        },
      });

      try {
        const { tokenUsage } = await this.embeddingService.generateAnnouncementEmbedding(announcementId);
        const embeddingProvider = getEmbeddingProvider(this.config);
        const embeddingModel = getEmbeddingModel(this.config);
        const analysisModel =
          this.config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-5-mini";
        const aiOperations = [
          buildAiOperationLog({
            name: "announcement-embedding",
            provider: embeddingProvider,
            model: embeddingModel,
          }),
          ...(tokenUsage
            ? [
                buildAiOperationLog({
                  name: "announcement-analysis",
                  provider: "OPENAI",
                  model: analysisModel,
                  promptTokens: tokenUsage.promptTokens,
                  completionTokens: tokenUsage.completionTokens,
                  totalTokens: tokenUsage.totalTokens,
                }),
              ]
            : []),
        ];

        const updated = await this.prisma.announcement.findUnique({
          where: { id: announcementId },
          select: { kind: true, detailedReport: true },
        });

        // After embedding, trigger re-matching for all active topics
        await this.matchingService.matchAllTopicsAgainstAnnouncement(announcementId);

        await this.jobLogger.finish({
          logId,
          status: "COMPLETED",
          result: {
            announcementId,
            kind: updated?.kind ?? null,
            reportLength: updated?.detailedReport?.length ?? null,
            embeddingProvider,
            embeddingModel,
            aiOperations,
            ...(tokenUsage ? {
              promptTokens: tokenUsage.promptTokens,
              completionTokens: tokenUsage.completionTokens,
              totalTokens: tokenUsage.totalTokens,
              estimatedCostUsd: aiOperations[1]?.estimatedCostUsd ?? null,
            } : {}),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.jobLogger.finish({ logId, status: "FAILED", error: message });
        throw err;
      }
      return;
    }

    // ── EMBED_TOPIC ──────────────────────────────────────────────────────────
    if (job.name === EmbeddingJob.EMBED_TOPIC) {
      const { topicId } = payload;
      this.logger.debug(`Processing EMBED_TOPIC for ${topicId}`);

      const meta = await this.prisma.topic.findUnique({
        where: { id: topicId },
        select: { title: true, project: { select: { client: { select: { companyName: true } } } } },
      });

      const entityTitle = meta
        ? `${meta.project.client.companyName} — ${meta.title}`
        : topicId;

      const logId = await this.jobLogger.start({
        type: "EMBEDDING",
        jobId: job.id,
        jobName: job.name,
        entityId: topicId,
        entityTitle,
        payload: { topicId },
      });

      try {
        await this.embeddingService.generateTopicEmbedding(topicId);
        await this.matchingService.matchTopic(topicId);
        const embeddingProvider = getEmbeddingProvider(this.config);
        const embeddingModel = getEmbeddingModel(this.config);

        await this.jobLogger.finish({
          logId,
          status: "COMPLETED",
          result: {
            topicId,
            embeddingProvider,
            embeddingModel,
            aiOperations: [
              buildAiOperationLog({
                name: "topic-embedding",
                provider: embeddingProvider,
                model: embeddingModel,
              }),
            ],
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.jobLogger.finish({ logId, status: "FAILED", error: message });
        throw err;
      }
      return;
    }

    this.logger.warn(`Unknown embedding job name: ${job.name}`);
  }
}
