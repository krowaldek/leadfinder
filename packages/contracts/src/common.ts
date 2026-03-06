import { z } from "zod";

export const accountTypeSchema = z.enum(["PERSONAL", "COMPANY"]);
export type AccountType = z.infer<typeof accountTypeSchema>;

export const userStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const systemRoleSchema = z.enum(["SUPER_ADMIN", "ADMIN"]);
export type SystemRole = z.infer<typeof systemRoleSchema>;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional().default(""),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const paginatedMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  totalPages: z.number().int().min(0),
});
export type PaginatedMeta = z.infer<typeof paginatedMetaSchema>;
