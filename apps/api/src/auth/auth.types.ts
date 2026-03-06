import { AuthUser } from "@leadfinder/contracts";

export interface JwtPayload {
  sub: string;
  role: AuthUser["systemRole"];
}

export interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}
