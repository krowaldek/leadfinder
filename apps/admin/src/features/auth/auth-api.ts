import {
  authResponseSchema,
  loginSchema,
  meResponseSchema,
  type LoginInput,
} from "@leadfinder/contracts";
import { api } from "@/lib/api";

export async function login(payload: LoginInput) {
  const body = loginSchema.parse(payload);
  const response = await api.post("/auth/login", body);
  return authResponseSchema.parse(response.data);
}

export async function fetchMe() {
  const response = await api.get("/auth/me");
  return meResponseSchema.parse(response.data);
}

export async function refreshSession() {
  const response = await api.post("/auth/refresh", {});
  return authResponseSchema.parse(response.data);
}

export async function logout() {
  await api.post("/auth/logout", {});
}
