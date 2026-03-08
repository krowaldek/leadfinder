import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";
import type { SearchResultItem } from "@leadfinder/contracts";

interface RawSearchRow {
  id: string;
  announcement_id: string;
  title: string;
  description: string | null;
  price: unknown;
  source: string;
  external_id: string;
  announcement_title: string;
  value_min: unknown;
  value_max: unknown;
  url: string;
  published_at: Date | null;
  similarity: number;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppEnv>,
  ) {}

  async semanticSearch(
    query: string,
    limit = 10,
    threshold = 0.3,
  ): Promise<SearchResultItem[]> {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set — cannot perform semantic search");
    }

    const model =
      this.config.get<string>("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

    this.logger.debug(`Generating query embedding for: "${query.slice(0, 80)}"`);

    const embedder = new OpenAIEmbeddings({ apiKey, model });
    const [queryVector] = await embedder.embedDocuments([query]);
    const vectorStr = `[${queryVector.join(",")}]`;

    this.logger.debug(`Running pgvector cosine search (limit=${limit}, threshold=${threshold})`);

    // 1 - cosine_distance = cosine_similarity
    const rows = await this.prisma.$queryRaw<RawSearchRow[]>`
      SELECT
        ai.id,
        ai."announcementId"    AS announcement_id,
        ai.title,
        ai.description,
        ai.price,
        a."sourceSystem"       AS source,
        a."externalId"         AS external_id,
        a.title                AS announcement_title,
        a."valueMin"           AS value_min,
        a."valueMax"           AS value_max,
        a.url,
        a."publishedAt"        AS published_at,
        (1 - (ai.embedding <=> ${vectorStr}::vector)) AS similarity
      FROM announcement_items ai
      JOIN announcements a ON a.id = ai."announcementId"
      WHERE
        ai.status = 'EMBEDDED'::"AnnouncementItemStatus"
        AND ai.embedding IS NOT NULL
        AND (1 - (ai.embedding <=> ${vectorStr}::vector)) >= ${threshold}
      ORDER BY ai.embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `;

    this.logger.log(`Search returned ${rows.length} results for query: "${query.slice(0, 60)}"`);

    return rows.map((row) => ({
      id: row.id,
      announcementId: row.announcement_id,
      title: row.title,
      description: row.description,
      price: row.price,
      source: row.source,
      externalId: row.external_id,
      announcementTitle: row.announcement_title,
      valueMin: row.value_min,
      valueMax: row.value_max,
      url: row.url,
      similarity: Number(row.similarity),
      publishedAt: row.published_at ? row.published_at.toISOString() : null,
    }));
  }
}
