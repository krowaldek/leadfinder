import { Injectable, Inject, Logger, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { AnnouncementSource, Prisma } from "@prisma/client";
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

interface PartData {
  title: string;
  description: string | null;
  searchContext: string;
  price: string | null;
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
   * Processes a raw announcement into flat Announcement records.
   *
   * Logic:
   *  – Reads the announcement with its rawData.
   *  – Extracts the `orders` array from BK rawData.
   *  – Multi-part: updates partIndex=0 row with part-0 data, creates/upserts
   *    additional rows for each extra part.
   *  – Single-part: updates the existing row (partIndex=0) with searchContext
   *    built from the announcement's own title/description.
   *  – Deletes stale part rows (partIndex >= number of parts).
   *  – Queues EMBED_ANNOUNCEMENT for each saved part row.
   */
  async processAnnouncement(announcementId: string): Promise<void> {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
    });

    if (!announcement) {
      throw new NotFoundException(`Announcement not found: ${announcementId}`);
    }

    this.logger.log(
      `Processing announcement ${announcementId} — "${announcement.title}"`,
    );

    const rawData = announcement.rawData as BkRawData;
    const orders: BkOrder[] = Array.isArray(rawData?.orders) ? rawData.orders : [];

    const parts: PartData[] =
      orders.length > 0
        ? this.buildPartsFromOrders(orders)
        : this.buildGeneralPart(announcement.title, announcement.description);

    this.logger.log(
      `Building ${parts.length} part(s) for announcement externalId=${announcement.externalId}`,
    );

    // Update the partIndex=0 row (which the scraper just upserted)
    const [firstPart, ...remainingParts] = parts;

    await this.prisma.announcement.update({
      where: { id: announcementId },
      data: {
        title: firstPart.title,
        description: firstPart.description,
        searchContext: firstPart.searchContext,
        valueMin: firstPart.price != null ? firstPart.price : announcement.valueMin,
        detailedReport: null, // clear stale report
        embeddingStatus: "PENDING",
      },
    });

    // Create/update remaining part rows
    const savedIds: string[] = [announcementId];

    for (let i = 0; i < remainingParts.length; i++) {
      const part = remainingParts[i];
      const partIndex = i + 1;

      const saved = await this.prisma.announcement.upsert({
        where: {
          sourceSystem_externalId_partIndex: {
            sourceSystem: announcement.sourceSystem,
            externalId: announcement.externalId,
            partIndex,
          },
        },
        create: {
          sourceSystem: announcement.sourceSystem,
          externalId: announcement.externalId,
          partIndex,
          title: part.title,
          description: part.description,
          url: announcement.url,
          status: announcement.status,
          publishedAt: announcement.publishedAt,
          deadlineAt: announcement.deadlineAt,
          searchContext: part.searchContext,
          valueMin: part.price ?? null,
          rawData: announcement.rawData ?? Prisma.JsonNull,
          embeddingStatus: "PENDING",
        },
        update: {
          title: part.title,
          description: part.description,
          searchContext: part.searchContext,
          valueMin: part.price ?? null,
          detailedReport: null,
          embeddingStatus: "PENDING",
        },
        select: { id: true },
      });

      savedIds.push(saved.id);
    }

    // Remove stale part rows (if announcement shrank in number of parts)
    await this.prisma.announcement.deleteMany({
      where: {
        sourceSystem: announcement.sourceSystem,
        externalId: announcement.externalId,
        partIndex: { gte: parts.length },
        id: { notIn: savedIds },
      },
    });

    // Queue embedding for every part row
    for (const savedId of savedIds) {
      await this.embeddingQueue.add(
        EmbeddingJob.EMBED_ANNOUNCEMENT,
        { announcementId: savedId },
        {
          jobId: `announcement-embed-${savedId}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      );
    }

    this.logger.log(
      `Queued ${savedIds.length} embed job(s) for externalId=${announcement.externalId}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildPartsFromOrders(orders: BkOrder[]): PartData[] {
    return orders.map((order) => {
      const orderItems: BkOrderItem[] = Array.isArray(order.order_items)
        ? order.order_items
        : [];

      const descriptions = orderItems
        .map((oi) => oi.description)
        .filter((d): d is string => !!d && d.trim().length > 0);

      const cpvNames = orderItems
        .flatMap((oi) => oi.cpv_items ?? [])
        .map((cpv) => `${cpv.code} ${cpv.name}`)
        .filter((v, i, arr) => arr.indexOf(v) === i);

      const title = order.title ?? `Część ${order.id}`;
      const description = descriptions.join("\n\n") || null;
      const searchContext = this.buildSearchContext(title, description, cpvNames);

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

  private buildGeneralPart(title: string, description: string | null): PartData[] {
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

  private normalizePrice(raw: number | string): string | null {
    if (typeof raw === "number") return String(raw);
    const normalized = String(raw).replace(/\s/g, "").replace(",", ".");
    if (Number.isNaN(Number(normalized))) return null;
    return normalized;
  }
}
