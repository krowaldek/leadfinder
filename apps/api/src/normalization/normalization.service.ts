import { Injectable, Inject, Logger, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../database/prisma.service.js";
import {
  EMBEDDING_QUEUE,
  EmbeddingJob,
} from "../embedding/embedding-queue.constants.js";

// ---------------------------------------------------------------------------
// BK rawData shape (orders array)
// ---------------------------------------------------------------------------

interface BkCpvItem {
  id: number;
  code: string;
  name: string;
}

interface BkOrderItem {
  id: number;
  description?: string;
  cpv_items?: BkCpvItem[];
  estimated_value?: number | string | null;
  subcategory?: { id: number; name: string };
  category?: { id: number; name: string };
}

interface BkOrder {
  id: number;
  title?: string;
  order_items?: BkOrderItem[];
  estimated_value?: number | string | null;
}

interface BkRawData {
  orders?: BkOrder[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class NormalizationService {
  private readonly logger = new Logger(NormalizationService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @InjectQueue(EMBEDDING_QUEUE)
    private readonly embeddingQueue: Queue,
  ) {}

  /**
   * Przetwarza ogłoszenie na pozycje (AnnouncementItem).
   *
   * Logika:
   *  – Pobiera announcement wraz z rawData.
   *  – Wyciąga tablicę `orders` (odpowiednik "positionLines" w BK API).
   *  – Jeśli orders nie są puste → jeden AnnouncementItem per order.
   *  – Jeśli orders są puste   → jeden ogólny item z tytułu ogłoszenia.
   *  – Usuwa poprzednie items i tworzy nowe w jednej transakcji.
   *  – Dla każdego buduje searchContext: "TYTUŁ: … | OPIS: … | KODY CPV: …"
   */
  async processAnnouncementToItems(announcementId: string): Promise<void> {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
    });

    if (!announcement) {
      throw new NotFoundException(
        `Announcement not found: ${announcementId}`,
      );
    }

    this.logger.log(
      `Processing announcement ${announcementId} — "${announcement.title}"`,
    );

    const rawData = announcement.rawData as BkRawData;
    const orders: BkOrder[] = Array.isArray(rawData?.orders)
      ? rawData.orders
      : [];

    const itemsToCreate =
      orders.length > 0
        ? this.buildItemsFromOrders(orders)
        : this.buildGeneralItem(announcement.title, announcement.description);

    this.logger.log(
      `Building ${itemsToCreate.length} item(s) for announcement ${announcementId}`,
    );

    // Usuń stare itemy i wstaw nowe atomowo
    await this.prisma.$transaction([
      this.prisma.announcementItem.deleteMany({
        where: { announcementId },
      }),
      this.prisma.announcementItem.createMany({
        data: itemsToCreate.map((item, index) => ({
          announcementId,
          itemIndex: index,
          title: item.title,
          description: item.description ?? null,
          searchContext: item.searchContext,
          price: item.price != null ? item.price : null,
          status: "PENDING" as const,
        })),
      }),
    ]);

    this.logger.log(
      `Saved ${itemsToCreate.length} item(s) for announcement ${announcementId}`,
    );

    // Pobierz UUID zapisanych itemów i wrzuć do kolejki embedding
    const savedItems = await this.prisma.announcementItem.findMany({
      where: { announcementId },
      select: { id: true },
      orderBy: { itemIndex: "asc" },
    });

    for (const item of savedItems) {
      await this.embeddingQueue.add(
        EmbeddingJob.EMBED_ITEM,
        { itemId: item.id },
        {
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      );
    }

    this.logger.log(
      `Enqueued ${savedItems.length} embedding job(s) for announcement ${announcementId}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildItemsFromOrders(orders: BkOrder[]) {
    return orders.map((order) => {
      const orderItems: BkOrderItem[] = Array.isArray(order.order_items)
        ? order.order_items
        : [];

      // Łączymy opisy z wszystkich order_items danej części
      const descriptions = orderItems
        .map((oi) => oi.description)
        .filter((d): d is string => !!d && d.trim().length > 0);

      // Spłaszczamy kody CPV ze wszystkich order_items
      const cpvNames = orderItems
        .flatMap((oi) => oi.cpv_items ?? [])
        .map((cpv) => `${cpv.code} ${cpv.name}`)
        .filter((v, i, arr) => arr.indexOf(v) === i); // deduplikacja

      const title = order.title ?? `Część ${order.id}`;
      const description = descriptions.join("\n\n") || null;

      const searchContext = this.buildSearchContext(title, description, cpvNames);

      // Wartość szacunkowa — najpierw z orders.estimated_value, fallback z pierwszego order_item
      const rawPrice =
        order.estimated_value ??
        orderItems.find((oi) => oi.estimated_value != null)?.estimated_value ??
        null;

      return {
        title,
        description,
        searchContext,
        price: rawPrice != null ? this.normalizePrice(rawPrice) : null,
      };
    });
  }

  private buildGeneralItem(
    title: string,
    description: string | null,
  ) {
    return [
      {
        title,
        description,
        searchContext: this.buildSearchContext(title, description, []),
        price: null,
      },
    ];
  }

  private buildSearchContext(
    title: string,
    description: string | null,
    cpvNames: string[],
  ): string {
    const parts: string[] = [`TYTUŁ: ${title}`];

    if (description) {
      // Skracamy opis do 1000 znaków żeby nie przekroczyć limitu tokenów
      const truncated =
        description.length > 1000
          ? `${description.slice(0, 1000)}…`
          : description;
      parts.push(`OPIS: ${truncated}`);
    }

    if (cpvNames.length > 0) {
      parts.push(`KODY CPV: ${cpvNames.join("; ")}`);
    }

    return parts.join(" | ");
  }

  /**
   * Normalizuje wartość ceny z BK API do formatu akceptowanego przez Prisma Decimal.
   * BK zwraca ceny jako liczby lub stringi z europejskim formatem (np. "1 234,56").
   */
  private normalizePrice(raw: number | string): string | null {
    if (typeof raw === "number") return String(raw);
    // Usuń spacje grupowania, zamień przecinek na kropkę
    const normalized = String(raw).replace(/\s/g, "").replace(",", ".");
    // Walidacja: musi być parsowalna jako liczba
    if (Number.isNaN(Number(normalized))) return null;
    return normalized;
  }
}
