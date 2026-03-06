import { beforeEach, describe, expect, it, vi } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { AuthService } from "../auth.service.js";

const prisma = {
  user: {
    findUnique: vi.fn(),
  },
  refreshTokenSession: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
};

const auditService = {
  log: vi.fn(),
};

describe("AuthService", () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    authService = new AuthService(
      prisma as never,
      { signAsync: vi.fn().mockResolvedValue("access-token") } as unknown as JwtService,
      {
        get: vi.fn((key: string) => {
          if (key === "ACCESS_TOKEN_TTL") return "15m";
          if (key === "REFRESH_TOKEN_TTL_DAYS") return 7;
          return undefined;
        }),
        getOrThrow: vi.fn(() => "secret-value-secret-value"),
      } as unknown as ConfigService,
      auditService as never,
    );
  });

  it("should reject invalid credentials", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      authService.login({ email: "x@example.com", password: "password123" }, {}),
    ).rejects.toThrow("Invalid email or password");
  });
});
