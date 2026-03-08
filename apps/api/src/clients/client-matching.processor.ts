import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
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
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === ClientMatchingJob.MATCH_CLIENT) {
      const { clientId } = job.data as MatchClientPayload;
      this.logger.debug(`Processing rematch job for client ${clientId}`);
      const count = await this.clientMatchingService.matchClient(clientId);
      this.logger.log(`Rematch complete: ${count} matches for client ${clientId}`);
    }
  }
}
