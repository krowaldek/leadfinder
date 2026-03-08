import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PrismaService } from "../database/prisma.service.js";
import type { AppEnv } from "../config/env.js";

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppEnv>,
  ) {}

  /**
   * Generuje embedding dla AnnouncementItem.searchContext przez OpenAI
   * i zapisuje wynik do kolumny `embedding` (pgvector) przez raw SQL.
   *
   * Model domyślny: text-embedding-3-small (1536 dim, tani, szybki).
   * Konfiguracja: OPENAI_API_KEY, OPENAI_EMBEDDING_MODEL w .env
   */
  async generateItemEmbedding(itemId: string): Promise<void> {
    const item = await this.prisma.announcementItem.findUnique({
      where: { id: itemId },
      select: { id: true, searchContext: true, status: true },
    });

    if (!item) {
      throw new NotFoundException(`AnnouncementItem not found: ${itemId}`);
    }

    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set — cannot generate embeddings",
      );
    }

    const model =
      this.config.get<string>("OPENAI_EMBEDDING_MODEL") ??
      "text-embedding-3-small";

    this.logger.debug(
      `Embedding item ${itemId} with model="${model}", context length=${item.searchContext.length}`,
    );

    try {
      const embedder = new OpenAIEmbeddings({ apiKey, model });
      const [vector] = await embedder.embedDocuments([item.searchContext]);

      // Prisma nie obsługuje pgvector natywnie — zapisujemy przez raw SQL
      const vectorStr = `[${vector.join(",")}]`;

      await this.prisma.$executeRaw`
        UPDATE announcement_items
        SET
          embedding  = ${vectorStr}::vector,
          status     = 'EMBEDDED'::"AnnouncementItemStatus",
          "updatedAt" = NOW()
        WHERE id = ${itemId}::uuid
      `;

      this.logger.log(`Embedded item ${itemId} (${vector.length} dims)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to embed item ${itemId}: ${msg}`);

      // Oznacz jako ERROR — job nie zostanie ponowiony (błąd zapisany w DB)
      await this.prisma.announcementItem.update({
        where: { id: itemId },
        data: { status: "ERROR" },
      });

      throw err; // BullMQ zarejestruje błąd joba (retry / dead-letter)
    }
  }
}
