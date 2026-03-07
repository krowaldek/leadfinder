import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AnnouncementsListQuery } from "@leadfinder/contracts";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async findAll(query: AnnouncementsListQuery) {
    const search = (query.search ?? "").trim();

    const where = {
      ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
      ...(query.source ? { sourceSystem: query.source } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.announcement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          sourceSystem: true,
          externalId: true,
          title: true,
          description: true,
          url: true,
          status: true,
          valueMin: true,
          valueMax: true,
          publishedAt: true,
          deadlineAt: true,
          rawData: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.announcement.count({ where }),
    ]);

    return {
      data: rows.map((a) => ({
        ...a,
        valueMin: a.valueMin != null ? a.valueMin.toString() : null,
        valueMax: a.valueMax != null ? a.valueMax.toString() : null,
      })),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
      },
    };
  }

  async findOne(id: string) {
    const a = await this.prisma.announcement.findUnique({
      where: { id },
      select: {
        id: true,
        sourceSystem: true,
        externalId: true,
        title: true,
        description: true,
        url: true,
        status: true,
        valueMin: true,
        valueMax: true,
        publishedAt: true,
        deadlineAt: true,
        rawData: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!a) throw new NotFoundException("Announcement not found");

    return {
      ...a,
      valueMin: a.valueMin != null ? a.valueMin.toString() : null,
      valueMax: a.valueMax != null ? a.valueMax.toString() : null,
    };
  }
}
