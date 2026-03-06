import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { loginSchema, refreshSchema } from "@leadfinder/contracts";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { JwtAuthGuard } from "../common/jwt-auth.guard.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import { AuthUser, LoginInput, RefreshInput } from "@leadfinder/contracts";

const REFRESH_COOKIE_NAME = "lf_refresh_token";

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  @Post("login")
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.login(body, {
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip,
    });

    response.cookie(
      REFRESH_COOKIE_NAME,
      session.refreshToken,
      this.getRefreshCookieOptions(this.isSecureRequest(request)),
    );

    return {
      user: session.user,
      accessToken: session.accessToken,
    };
  }

  @Post("refresh")
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const requestWithCookies = request as Request & { cookies?: Record<string, string> };
    const refreshToken = body.refreshToken ?? requestWithCookies.cookies?.[REFRESH_COOKIE_NAME];

    if (!refreshToken) {
      throw new UnauthorizedException("Refresh session is invalid");
    }

    const session = await this.authService.refresh(refreshToken, {
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip,
    });

    response.cookie(
      REFRESH_COOKIE_NAME,
      session.refreshToken,
      this.getRefreshCookieOptions(this.isSecureRequest(request)),
    );

    return {
      user: session.user,
      accessToken: session.accessToken,
    };
  }

  @Post("logout")
  async logout(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const requestWithCookies = request as Request & { cookies?: Record<string, string> };
    const refreshToken = body.refreshToken ?? requestWithCookies.cookies?.[REFRESH_COOKIE_NAME];

    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    response.clearCookie(
      REFRESH_COOKIE_NAME,
      this.getRefreshCookieOptions(this.isSecureRequest(request)),
    );
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  async me(@CurrentUser() user: AuthUser) {
    return {
      data: await this.authService.me(user.id),
    };
  }

  private getRefreshCookieOptions(isSecureRequest: boolean) {
    const refreshDays = this.configService.get<number>("REFRESH_TOKEN_TTL_DAYS") ?? 7;
    return {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: isSecureRequest,
      path: "/auth",
      maxAge: refreshDays * 24 * 60 * 60 * 1000,
    };
  }

  private isSecureRequest(request: Request): boolean {
    const forwardedProtoHeader = request.headers["x-forwarded-proto"];
    const forwardedProto = Array.isArray(forwardedProtoHeader)
      ? forwardedProtoHeader[0]
      : forwardedProtoHeader;

    return request.secure || request.protocol === "https" || forwardedProto === "https";
  }
}
