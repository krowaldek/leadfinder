import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { LoginInput, AuthResponse } from "@leadfinder/contracts";
import { compare, hash } from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../database/prisma.service.js";
import { mapUserToAuthUser } from "./auth.mapper.js";
import { RequestMeta } from "./auth.types.js";
import { AuditService } from "../audit/audit.service.js";

export interface AuthSession extends AuthResponse {
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(JwtService)
    private readonly jwtService: JwtService,
    @Inject(ConfigService)
    private readonly configService: ConfigService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
  ) {}

  async login(input: LoginInput, meta: RequestMeta): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });

    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const isValid = await compare(input.password, user.passwordHash);

    if (!isValid || user.status !== "ACTIVE") {
      throw new UnauthorizedException("Invalid email or password");
    }

    const authResponse = await this.createAuthResponse(user.id, meta);

    await this.auditService.log({
      actorUserId: user.id,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
    });

    return authResponse;
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthSession> {
    const tokenHash = this.hashToken(refreshToken);
    const session = await this.prisma.refreshTokenSession.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: true,
      },
    });

    if (!session || session.user.status !== "ACTIVE") {
      throw new UnauthorizedException("Refresh session is invalid");
    }

    await this.prisma.refreshTokenSession.update({
      where: { id: session.id },
      data: {
        revokedAt: new Date(),
        lastUsedAt: new Date(),
      },
    });

    return this.createAuthResponse(session.user.id, meta);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);

    await this.prisma.refreshTokenSession.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    return mapUserToAuthUser(user);
  }

  async createPasswordHash(password: string) {
    return hash(password, 10);
  }

  private async createAuthResponse(userId: string, meta: RequestMeta): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new BadRequestException("User not found");
    }

    const accessTokenTtl = (this.configService.get<string>("ACCESS_TOKEN_TTL") ??
      "15m") as `${number}${"m" | "h" | "d"}`;

    const accessToken = await this.jwtService.signAsync(
      {
        role: user.systemRole,
      },
      {
        secret: this.configService.getOrThrow<string>("JWT_ACCESS_SECRET"),
        expiresIn: accessTokenTtl,
        subject: user.id,
      },
    );

    const refreshToken = randomBytes(48).toString("hex");
    const refreshDays = this.configService.get<number>("REFRESH_TOKEN_TTL_DAYS") ?? 7;
    const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);

    await this.prisma.refreshTokenSession.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        expiresAt,
      },
    });

    return {
      user: mapUserToAuthUser(user),
      accessToken,
      refreshToken,
    };
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
}
