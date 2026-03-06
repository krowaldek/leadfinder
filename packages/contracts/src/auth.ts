import { z } from "zod";
import { accountTypeSchema, systemRoleSchema, userStatusSchema } from "./common.js";

export const authUserSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  fullName: z.string().min(1),
  systemRole: systemRoleSchema,
  accountType: accountTypeSchema,
  companyName: z.string().nullable(),
  status: userStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const authResponseSchema = z.object({
  user: authUserSchema,
  accessToken: z.string().min(1),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const meResponseSchema = z.object({
  data: authUserSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;
