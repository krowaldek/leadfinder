import { api } from "@/lib/api";
import {
  clientsListResponseSchema,
  clientMatchesResponseSchema,
  promptResponseSchema,
  updateMatchStatusSchema,
  clientResponseSchema,
  type ClientMatchStatus,
  type UpdateClient,
} from "@leadfinder/contracts";

export async function fetchClients(page = 1, limit = 20) {
  const response = await api.get("/clients", { params: { page, limit } });
  return clientsListResponseSchema.parse(response.data);
}

export async function fetchClientMatches(clientId: string) {
  const response = await api.get(`/clients/${clientId}/matches`);
  return clientMatchesResponseSchema.parse(response.data);
}

export async function sendPromptMessage(
  sessionId: string | undefined,
  message: string,
) {
  const response = await api.post("/clients/prompt", { sessionId, message });
  return promptResponseSchema.parse(response.data);
}

export async function rematchClient(clientId: string) {
  const response = await api.post(`/clients/${clientId}/rematch`);
  return response.data as { queued: true };
}

export async function updateClient(clientId: string, data: UpdateClient) {
  const response = await api.patch(`/clients/${clientId}`, data);
  return clientResponseSchema.parse(response.data.data);
}

export async function updateMatchStatus(
  clientId: string,
  matchId: string,
  status: ClientMatchStatus,
) {
  const payload = updateMatchStatusSchema.parse({ status });
  const response = await api.patch(
    `/clients/${clientId}/matches/${matchId}/status`,
    payload,
  );
  return response.data;
}
