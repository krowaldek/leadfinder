import {
  createUserSchema,
  updateUserSchema,
  updateUserStatusSchema,
  usersListResponseSchema,
  userResponseSchema,
  type CreateUserInput,
  type UpdateUserInput,
  type UpdateUserStatusInput,
} from "@leadfinder/contracts";
import { api } from "@/lib/api";

export async function fetchUsers(search: string, page: number, limit: number) {
  const response = await api.get("/users", {
    params: {
      page,
      limit,
      search,
    },
  });

  return usersListResponseSchema.parse(response.data);
}

export async function createUser(payload: CreateUserInput) {
  const response = await api.post("/users", createUserSchema.parse(payload));
  return userResponseSchema.parse(response.data);
}

export async function updateUser(id: string, payload: UpdateUserInput) {
  const response = await api.patch(`/users/${id}`, updateUserSchema.parse(payload));
  return userResponseSchema.parse(response.data);
}

export async function updateUserStatus(id: string, payload: UpdateUserStatusInput) {
  const response = await api.patch(`/users/${id}/status`, updateUserStatusSchema.parse(payload));
  return userResponseSchema.parse(response.data);
}
