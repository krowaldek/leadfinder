import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsersService } from "../users.service.js";

const prisma = {
  user: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn((queries: Array<Promise<unknown>>) => Promise.all(queries)),
};

const authService = {
  createPasswordHash: vi.fn().mockResolvedValue("hashed-password"),
};

const auditService = {
  log: vi.fn(),
};

const superAdminActor = {
  id: "actor-super-admin",
  email: "superadmin@example.com",
  firstName: "Super",
  lastName: "Admin",
  fullName: "Super Admin",
  systemRole: "SUPER_ADMIN" as const,
  accountType: "PERSONAL" as const,
  companyName: null,
  status: "ACTIVE" as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const adminActor = {
  ...superAdminActor,
  id: "actor-admin",
  systemRole: "ADMIN" as const,
};

describe("UsersService", () => {
  let usersService: UsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    usersService = new UsersService(prisma as never, authService as never, auditService as never);
  });

  it("should return paginated users list", async () => {
    prisma.$transaction.mockResolvedValue([
      [
        {
          id: "1",
          email: "admin@example.com",
          firstName: "Admin",
          lastName: "User",
          systemRole: "SUPER_ADMIN",
          accountType: "PERSONAL",
          companyName: null,
          status: "ACTIVE",
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
          updatedAt: new Date("2024-01-01T00:00:00.000Z"),
        },
      ],
      1,
    ]);

    const result = await usersService.findAll({ page: 1, limit: 20, search: "" });

    expect(result.meta.total).toBe(1);
    expect(result.data[0]?.fullName).toBe("Admin User");
  });

  it("should block ADMIN from creating SUPER_ADMIN", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      usersService.create(
        {
          email: "new-super-admin@example.com",
          firstName: "New",
          lastName: "SuperAdmin",
          password: "Password123!",
          systemRole: "SUPER_ADMIN",
          accountType: "PERSONAL",
          companyName: null,
          status: "ACTIVE",
        },
        adminActor,
      ),
    ).rejects.toThrow("Only SUPER_ADMIN can create SUPER_ADMIN accounts");
  });

  it("should block deactivating last active SUPER_ADMIN", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "target-super-admin",
      email: "target@example.com",
      firstName: "Target",
      lastName: "SuperAdmin",
      systemRole: "SUPER_ADMIN",
      accountType: "PERSONAL",
      companyName: null,
      status: "ACTIVE",
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    });
    prisma.user.count.mockResolvedValue(1);

    await expect(
      usersService.updateStatus("target-super-admin", { status: "INACTIVE" }, superAdminActor),
    ).rejects.toThrow("At least one active SUPER_ADMIN account must remain");
  });
});
