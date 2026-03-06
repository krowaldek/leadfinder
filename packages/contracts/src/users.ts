import { z } from "zod";
import {
  accountTypeSchema,
  listQuerySchema,
  paginatedMetaSchema,
  systemRoleSchema,
  userStatusSchema,
} from "./common.js";
import { authUserSchema } from "./auth.js";

export const usersListQuerySchema = listQuerySchema;
export type UsersListQuery = z.infer<typeof usersListQuerySchema>;

export const createUserSchema = z
  .object({
    email: z.email(),
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    password: z.string().min(8),
    systemRole: systemRoleSchema,
    accountType: accountTypeSchema,
    companyName: z.string().trim().nullable().optional(),
    status: userStatusSchema.default("ACTIVE"),
  })
  .superRefine((value, ctx) => {
    if (value.accountType === "COMPANY" && !value.companyName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["companyName"],
        message: "Company name is required for company accounts.",
      });
    }
  });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    systemRole: systemRoleSchema.optional(),
    accountType: accountTypeSchema.optional(),
    companyName: z.string().trim().nullable().optional(),
    status: userStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const updateUserStatusSchema = z.object({
  status: userStatusSchema,
});
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const userResponseSchema = z.object({
  data: authUserSchema,
});
export type UserResponse = z.infer<typeof userResponseSchema>;

export const usersListResponseSchema = z.object({
  data: z.array(authUserSchema),
  meta: paginatedMetaSchema,
});
export type UsersListResponse = z.infer<typeof usersListResponseSchema>;
