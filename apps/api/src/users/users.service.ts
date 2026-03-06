import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AuthUser,
  CreateUserInput,
  UpdateUserInput,
  UpdateUserStatusInput,
  UsersListQuery,
} from "@leadfinder/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { mapUserToAuthUser } from "../auth/auth.mapper.js";
import { AuthService } from "../auth/auth.service.js";
import { AuditService } from "../audit/audit.service.js";

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: UsersListQuery) {
    const search = query.search.trim();
    const where = search
      ? {
          OR: [
            { email: { contains: search } },
            { firstName: { contains: search } },
            { lastName: { contains: search } },
            { companyName: { contains: search } },
          ],
        }
      : {};

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users.map(mapUserToAuthUser),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
      },
    };
  }

  async findOne(id: string) {
    const user = await this.findUserEntity(id);
    return mapUserToAuthUser(user);
  }

  async create(input: CreateUserInput, actor: AuthUser) {
    if (actor.systemRole !== "SUPER_ADMIN" && input.systemRole === "SUPER_ADMIN") {
      throw new ForbiddenException("Only SUPER_ADMIN can create SUPER_ADMIN accounts");
    }

    const email = input.email.toLowerCase();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      throw new ConflictException("Email is already in use");
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await this.authService.createPasswordHash(input.password),
        firstName: input.firstName,
        lastName: input.lastName,
        systemRole: input.systemRole,
        accountType: input.accountType,
        companyName: input.accountType === "COMPANY" ? (input.companyName ?? null) : null,
        status: input.status,
      },
    });

    await this.auditService.log({
      actorUserId: actor.id,
      action: "users.create",
      entityType: "user",
      entityId: user.id,
      payload: {
        email: user.email,
        systemRole: user.systemRole,
        accountType: user.accountType,
      },
    });

    return mapUserToAuthUser(user);
  }

  async update(id: string, input: UpdateUserInput, actor: AuthUser) {
    const targetUser = await this.findUserEntity(id);

    if (actor.systemRole !== "SUPER_ADMIN" && targetUser.systemRole === "SUPER_ADMIN") {
      throw new ForbiddenException("Only SUPER_ADMIN can modify SUPER_ADMIN accounts");
    }

    if (actor.systemRole !== "SUPER_ADMIN" && input.systemRole === "SUPER_ADMIN") {
      throw new ForbiddenException("Only SUPER_ADMIN can assign SUPER_ADMIN role");
    }

    if (actor.id === id && input.status === "INACTIVE") {
      throw new BadRequestException("You cannot deactivate your own account");
    }

    const nextRole = input.systemRole ?? targetUser.systemRole;
    const nextStatus = input.status ?? targetUser.status;

    await this.assertLastSuperAdminGuard(targetUser, nextRole, nextStatus);

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        systemRole: input.systemRole,
        accountType: input.accountType,
        companyName:
          input.accountType === "COMPANY"
            ? (input.companyName ?? null)
            : input.accountType === "PERSONAL"
              ? null
              : input.companyName,
        status: input.status,
      },
    });

    await this.auditService.log({
      actorUserId: actor.id,
      action: "users.update",
      entityType: "user",
      entityId: user.id,
      payload: {
        systemRole: user.systemRole,
        accountType: user.accountType,
        status: user.status,
      },
    });

    return mapUserToAuthUser(user);
  }

  async updateStatus(id: string, input: UpdateUserStatusInput, actor: AuthUser) {
    const targetUser = await this.findUserEntity(id);

    if (actor.systemRole !== "SUPER_ADMIN" && targetUser.systemRole === "SUPER_ADMIN") {
      throw new ForbiddenException("Only SUPER_ADMIN can modify SUPER_ADMIN accounts");
    }

    if (actor.id === id && input.status === "INACTIVE") {
      throw new BadRequestException("You cannot deactivate your own account");
    }

    await this.assertLastSuperAdminGuard(targetUser, targetUser.systemRole, input.status);

    const user = await this.prisma.user.update({
      where: { id },
      data: { status: input.status },
    });

    await this.auditService.log({
      actorUserId: actor.id,
      action: "users.update-status",
      entityType: "user",
      entityId: user.id,
      payload: { status: user.status },
    });

    return mapUserToAuthUser(user);
  }

  private async findUserEntity(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return user;
  }

  private async assertLastSuperAdminGuard(
    targetUser: { id: string; systemRole: "SUPER_ADMIN" | "ADMIN"; status: "ACTIVE" | "INACTIVE" },
    nextRole: "SUPER_ADMIN" | "ADMIN",
    nextStatus: "ACTIVE" | "INACTIVE",
  ) {
    if (targetUser.systemRole !== "SUPER_ADMIN") {
      return;
    }

    if (nextRole === "SUPER_ADMIN" && nextStatus === "ACTIVE") {
      return;
    }

    const activeSuperAdmins = await this.prisma.user.count({
      where: {
        systemRole: "SUPER_ADMIN",
        status: "ACTIVE",
      },
    });

    if (activeSuperAdmins <= 1) {
      throw new ConflictException("At least one active SUPER_ADMIN account must remain");
    }
  }
}
