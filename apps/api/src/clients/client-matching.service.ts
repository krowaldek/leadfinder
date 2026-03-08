import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";

interface MatchRow {
  announcement_item_id: string;
  similarity: number;
}

const MATCH_THRESHOLD = 0.35;
const MATCH_LIMIT = 50;

@Injectable()
export class ClientMatchingService {
  private readonly logger = new Logger(ClientMatchingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnv>,
  ) {}

  async matchClient(clientId: string): Promise<number> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, companyName: true, profileSummary: true },
    });

    if (!client) throw new Error(`Client not found: ${clientId}`);

    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const model =
      this.config.get<string>("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

    this.logger.debug(
      `Generating profile embedding for client: ${client.companyName}`,
    );

    const embedder = new OpenAIEmbeddings({ apiKey, model });
    const [vector] = await embedder.embedDocuments([client.profileSummary]);
    const vectorStr = `[${vector.join(",")}]`;

    await this.prisma.$executeRaw`
      UPDATE clients
      SET "profileEmbedding" = ${vectorStr}::vector, "updatedAt" = NOW()
      WHERE id = ${clientId}::uuid
    `;

    const rows = await this.prisma.$queryRaw<MatchRow[]>`
      SELECT
        ai.id AS announcement_item_id,
        (1 - (ai.embedding <=> ${vectorStr}::vector)) AS similarity
      FROM announcement_items ai
      WHERE
        ai.status = 'EMBEDDED'::"AnnouncementItemStatus"
        AND ai.embedding IS NOT NULL
        AND (1 - (ai.embedding <=> ${vectorStr}::vector)) >= ${MATCH_THRESHOLD}
      ORDER BY ai.embedding <=> ${vectorStr}::vector
      LIMIT ${MATCH_LIMIT}
    `;

    this.logger.log(
      `Found ${rows.length} matches for client "${client.companyName}"`,
    );

    for (const row of rows) {
      await this.prisma.clientMatch.upsert({
        where: {
          clientId_announcementItemId: {
            clientId,
            announcementItemId: row.announcement_item_id,
          },
        },
        create: {
          clientId,
          announcementItemId: row.announcement_item_id,
          similarity: Number(row.similarity),
          status: "NEW",
        },
        update: {
          similarity: Number(row.similarity),
          updatedAt: new Date(),
        },
      });
    }

    return rows.length;
  }
}
