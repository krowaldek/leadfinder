import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";

interface MatchRow {
  announcement_item_id: string;
  similarity: number;
  title: string;
  description: string | null;
}

const MATCH_THRESHOLD = 0.35;
const MATCH_LIMIT = 50;
const NEGATIVE_KEYWORD_PENALTY = 0.12; // sprowadza dopasowanie do ~12% oryginalnego score

function applyNegativePenalty(row: MatchRow, negativeKeywords: string[]): boolean {
  if (negativeKeywords.length === 0) return false;
  const haystack = `${row.title} ${row.description ?? ""}`.toLowerCase();
  return negativeKeywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

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
      select: { id: true, companyName: true, profileSummary: true, negativeKeywords: true },
    });

    if (!client) throw new Error(`Client not found: ${clientId}`);

    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    const model =
      this.config.get<string>("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

    this.logger.debug(
      `Generating profile embedding for client: ${client.companyName}`,
    );

    // Strip "WYKLUCZENIA:" section from profileSummary — negative keywords must NOT be embedded
    const embeddingText = client.profileSummary
      .split("WYKLUCZENIA:")[0]
      .trim();

    const embedder = new OpenAIEmbeddings({ apiKey, model });
    const [vector] = await embedder.embedDocuments([embeddingText]);
    const vectorStr = `[${vector.join(",")}]`;

    await this.prisma.$executeRaw`
      UPDATE clients
      SET "profileEmbedding" = ${vectorStr}::vector, "updatedAt" = NOW()
      WHERE id = ${clientId}::uuid
    `;

    const rows = await this.prisma.$queryRaw<MatchRow[]>`
      SELECT
        ai.id AS announcement_item_id,
        (1 - (ai.embedding <=> ${vectorStr}::vector)) AS similarity,
        ai.title,
        ai.description
      FROM announcement_items ai
      WHERE
        ai.status = 'EMBEDDED'::"AnnouncementItemStatus"
        AND ai.embedding IS NOT NULL
        AND (1 - (ai.embedding <=> ${vectorStr}::vector)) >= ${MATCH_THRESHOLD}
      ORDER BY ai.embedding <=> ${vectorStr}::vector
      LIMIT ${MATCH_LIMIT}
    `;

    const negativeKeywords: string[] = client.negativeKeywords ?? [];

    if (negativeKeywords.length > 0) {
      this.logger.debug(
        `Applying negative keyword penalty for ${negativeKeywords.length} exclusion(s): [${negativeKeywords.join(", ")}]`,
      );
    }

    this.logger.log(
      `Found ${rows.length} candidate matches for client "${client.companyName}"`,
    );

    let penalized = 0;
    for (const row of rows) {
      const isPenalized = applyNegativePenalty(row, negativeKeywords);
      const finalSimilarity = isPenalized
        ? Number(row.similarity) * NEGATIVE_KEYWORD_PENALTY
        : Number(row.similarity);

      if (isPenalized) penalized++;

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
          similarity: finalSimilarity,
          status: "NEW",
        },
        update: {
          similarity: finalSimilarity,
          updatedAt: new Date(),
        },
      });
    }

    if (penalized > 0) {
      this.logger.log(
        `Penalized ${penalized}/${rows.length} matches due to negative keyword exclusions`,
      );
    }

    return rows.length;
  }
}
