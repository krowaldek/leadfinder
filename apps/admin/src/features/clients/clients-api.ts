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
import {
  projectsListResponseSchema,
  projectResponseSchema,
  topicsListResponseSchema,
  topicResponseSchema,
  type CreateProject,
  type UpdateProject,
  type CreateTopic,
  type TopicMatchingProfile,
  type UpdateTopic,
} from "@leadfinder/contracts";

export async function fetchClients(page = 1, limit = 20) {
  const response = await api.get("/clients", { params: { page, limit } });
  return clientsListResponseSchema.parse(response.data);
}

export async function fetchClient(clientId: string) {
  const response = await api.get(`/clients/${clientId}`);
  return clientResponseSchema.parse(response.data.data);
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
  const response = await api.post(`/clients/${clientId}/rematch`, {});
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

// Projects

export async function fetchProjects(clientId: string) {
  const response = await api.get(`/clients/${clientId}/projects`);
  return projectsListResponseSchema.parse(response.data);
}

export async function createProject(clientId: string, data: CreateProject) {
  const response = await api.post(`/clients/${clientId}/projects`, data);
  return projectResponseSchema.parse(response.data);
}

export async function updateProject(clientId: string, projectId: string, data: UpdateProject) {
  const response = await api.patch(`/clients/${clientId}/projects/${projectId}`, data);
  return projectResponseSchema.parse(response.data);
}

export async function deleteProject(clientId: string, projectId: string) {
  await api.delete(`/clients/${clientId}/projects/${projectId}`);
}

// Topics

export async function fetchTopics(clientId: string, projectId: string) {
  const response = await api.get(`/clients/${clientId}/projects/${projectId}/topics`);
  return topicsListResponseSchema.parse(response.data);
}

export async function createTopic(clientId: string, projectId: string, data: CreateTopic) {
  const response = await api.post(`/clients/${clientId}/projects/${projectId}/topics`, data);
  return topicResponseSchema.parse(response.data);
}

export async function updateTopic(clientId: string, projectId: string, topicId: string, data: UpdateTopic) {
  const response = await api.patch(`/clients/${clientId}/projects/${projectId}/topics/${topicId}`, data);
  return topicResponseSchema.parse(response.data);
}

export async function deleteTopic(clientId: string, projectId: string, topicId: string) {
  await api.delete(`/clients/${clientId}/projects/${projectId}/topics/${topicId}`);
}

export async function embedTopic(clientId: string, projectId: string, topicId: string) {
  const response = await api.post(
    `/clients/${clientId}/projects/${projectId}/topics/${topicId}/embed`,
    {},
  );
  return response.data as { message: string; topicId: string };
}

export async function generateTopicPrompt(clientId: string, title: string) {
  const response = await api.post(`/clients/${clientId}/generate-topic-prompt`, { title });
  return response.data as { prompt: string; matchingProfile: TopicMatchingProfile };
}
