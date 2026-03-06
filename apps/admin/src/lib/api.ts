import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { getAuthSnapshot, useAuthStore } from "@/stores/auth-store";
import { authResponseSchema } from "@leadfinder/contracts";

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

function isAuthEndpoint(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  return /\/auth\/(login|refresh|logout)(?:\?|$)/.test(url);
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:3001",
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const { accessToken } = getAuthSnapshot();

  if (accessToken) {
    config.headers.set("Authorization", `Bearer ${accessToken}`);
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as RetriableRequestConfig | undefined;

    if (!request || request._retry || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    if (isAuthEndpoint(request.url)) {
      return Promise.reject(error);
    }

    request._retry = true;

    try {
      const refreshResponse = await axios.post(
        `${api.defaults.baseURL}/auth/refresh`,
        {},
        { withCredentials: true },
      );
      const parsed = authResponseSchema.parse(refreshResponse.data);
      useAuthStore.getState().setSession(parsed);
      request.headers.set("Authorization", `Bearer ${parsed.accessToken}`);
      return api(request);
    } catch (refreshError) {
      useAuthStore.getState().clearSession();

      if (window.location.pathname !== "/login") {
        window.location.replace("/login");
      }

      return Promise.reject(refreshError);
    }
  },
);
