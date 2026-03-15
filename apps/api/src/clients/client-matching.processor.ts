import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../database/prisma.service.js";
import { JobLoggerService } from "../logs/job-logger.service.js";
import { ClientMatchingService } from "./client-matching.service.js";
import {
  CLIENT_MATCHING_QUEUE,
  ClientMatchingJob,
} from "./client-matching.constants.js";

interface MatchClientPayload {
  clientId: string;
}

@Processor(CLIENT_MATCHING_QUEUE)
export class ClientMatchingProcessor extends WorkerHost {
  private readonly logger = new Logger(ClientMatchingProcessor.name);

  constructor(
    @Inject(ClientMatchingService)
    private readonly clientMatchingService: ClientMatchingService,
    @Inject(JobLoggerService)
    private readonly jobLogger: JobLoggerService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === ClientMatchingJob.MATCH_CLIENT) {
      const { clientId } = job.data as MatchClientPayload;
      this.logger.debug(`Processing rematch job for client ${clientId}`);

      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
        select: {
          companyName: true,
          _count: {
            select: {
              projects: true,
            },
          },
        },
      });

      const logId = await this.jobLogger.start({
        type: "MATCHING",
        jobId: job.id != null ? String(job.id) : undefined,
        jobName: job.name,
        entityId: clientId,
        entityTitle: client?.companyName ?? clientId,
        payload: {
          clientId,
          companyName: client?.companyName ?? null,
          projectCount: client?._count.projects ?? null,
          attemptsMade: job.attemptsMade,
        },
      });

      try {
        const count = await this.clientMatchingService.matchClient(clientId);

        await this.jobLogger.finish({
          logId,
          status: "COMPLETED",
          result: {
            clientId,
            companyName: client?.companyName ?? null,
            projectCount: client?._count.projects ?? null,
            matchedAnnouncements: count,
          },
        });

        this.logger.log(`Rematch complete: ${count} matches for client ${clientId}`);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        await this.jobLogger.finish({
          logId,
          status: "FAILED",
          error: message,
          result: {
            clientId,
            companyName: client?.companyName ?? null,
            projectCount: client?._count.projects ?? null,
          },
        });

        throw error;
      }
    }
  }
}
