import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientMatchingService } from "./client-matching.service.js";

describe("ClientMatchingService", () => {
  const prisma = {
    $queryRaw: vi.fn(),
    clientMatch: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  const config = {
    get: vi.fn(() => undefined),
  };

  let service: ClientMatchingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClientMatchingService(prisma as never, config as never);
  });

  it("does not keep false positive match for unrelated announcement domain", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "topic-1",
          title: "Ubezpieczenia grupowe dla pracowników",
          prompt:
            "Szukamy zamówień na grupowe ubezpieczenia na życie i zdrowie dla pracowników, polisy pracownicze, pakiety medyczne i benefity ubezpieczeniowe.",
          embedding: "[0.1,0.2,0.3]",
          negative_keywords: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          announcement_id: "ann-1",
          similarity: 0.69,
          title: "Dostawa baterii trakcyjnych",
          description: "Zakup baterii do wózków",
          search_context: "TYTUŁ: Dostawa baterii trakcyjnych | OPIS: Zakup baterii do magazynu",
        },
      ])
      .mockResolvedValueOnce([]);

    const count = await service.matchTopic("topic-1");

    expect(count).toBe(0);
    expect(prisma.clientMatch.upsert).not.toHaveBeenCalled();
    expect(prisma.clientMatch.deleteMany).toHaveBeenCalledWith({ where: { topicId: "topic-1" } });
  });

  it("keeps fast announcement-to-topic match when domain really overlaps", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "ann-2",
          title: "Grupowe ubezpieczenie na życie dla pracowników urzędu",
          description: "Polisa dla pracowników jednostki",
          search_context:
            "TYTUŁ: Grupowe ubezpieczenie na życie dla pracowników urzędu | OPIS: polisa pracownicza",
          embedding: "[0.1,0.2,0.3]",
        },
      ])
      .mockResolvedValueOnce([
        {
          topic_id: "topic-1",
          title: "Ubezpieczenia grupowe dla pracowników",
          prompt:
            "Szukamy zamówień na grupowe ubezpieczenia na życie i zdrowie dla pracowników, polisy pracownicze, pakiety medyczne i benefity ubezpieczeniowe.",
          similarity: 0.74,
          negative_keywords: [],
        },
      ]);

    await service.matchAllTopicsAgainstAnnouncement("ann-2");

    expect(prisma.clientMatch.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.clientMatch.upsert.mock.calls[0]?.[0]).toMatchObject({
      where: {
        topicId_announcementId: { topicId: "topic-1", announcementId: "ann-2" },
      },
    });
  });

  it("does not keep broad insurance offers for employee group insurance topic", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "topic-1",
          title: "Zamówienia na ubezpieczenia grupowe dla pracowników",
          prompt:
            "Szukamy zamówień na grupowe ubezpieczenia na życie i zdrowie dla pracowników, polisy pracownicze, pakiety medyczne i benefity ubezpieczeniowe.",
          embedding: "[0.1,0.2,0.3]",
          negative_keywords: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          announcement_id: "ann-3",
          similarity: 0.72,
          title: "Kompleksowe ubezpieczenie mienia i OC gminy",
          description: "Ubezpieczenie majątku jednostek samorządowych",
          search_context: "TYTUŁ: Kompleksowe ubezpieczenie mienia i OC gminy | OPIS: ubezpieczenie jednostek samorządowych",
        },
      ])
      .mockResolvedValueOnce([]);

    const count = await service.matchTopic("topic-1");

    expect(count).toBe(0);
    expect(prisma.clientMatch.upsert).not.toHaveBeenCalled();
  });
});