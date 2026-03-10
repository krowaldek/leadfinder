import { GoogleGenAI, createPartFromBase64 } from "@google/genai";
import { ConfigService } from "@nestjs/config";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { AppEnv } from "../config/env.js";

export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_GOOGLE_EMBEDDING_MODEL = "gemini-embedding-2-preview";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

export type EmbeddingProvider = AppEnv["EMBEDDING_PROVIDER"];
type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

function hasConfiguredSecret(value: string | undefined): value is string {
  if (!value) return false;

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !normalized.includes("xxx") && !normalized.includes("changeme");
}

export function getEmbeddingProvider(
  config: ConfigService<AppEnv>,
): EmbeddingProvider {
  return config.get<EmbeddingProvider>("EMBEDDING_PROVIDER") ?? "OPENAI";
}

export function getEmbeddingModel(config: ConfigService<AppEnv>): string {
  return getEmbeddingProvider(config) === "GOOGLE"
    ? (config.get<string>("GOOGLE_EMBEDDING_MODEL") ?? DEFAULT_GOOGLE_EMBEDDING_MODEL)
    : (config.get<string>("OPENAI_EMBEDDING_MODEL") ?? DEFAULT_OPENAI_EMBEDDING_MODEL);
}

export function getEmbeddingDimensions(config: ConfigService<AppEnv>): number {
  return (
    config.get<number>("EMBEDDING_DIMENSIONS") ?? DEFAULT_EMBEDDING_DIMENSIONS
  );
}

export function hasValidEmbeddingConfig(
  config: ConfigService<AppEnv>,
): boolean {
  if (getEmbeddingProvider(config) === "GOOGLE") {
    return hasConfiguredSecret(config.get<string>("GOOGLE_API_KEY"));
  }

  return hasConfiguredSecret(config.get<string>("OPENAI_API_KEY"));
}

export class AppEmbeddings {
  constructor(private readonly config: ConfigService<AppEnv>) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embed(texts, "RETRIEVAL_DOCUMENT");
  }

  async embedQuery(query: string): Promise<number[]> {
    const [vector] = await this.embed([query], "RETRIEVAL_QUERY");
    return vector;
  }

  async embedPdfDocuments(pdfBuffers: Buffer[]): Promise<number[][]> {
    if (pdfBuffers.length === 0) {
      return [];
    }

    if (getEmbeddingProvider(this.config) !== "GOOGLE") {
      return [];
    }

    return this.embedPdfWithGoogle(pdfBuffers);
  }

  private async embed(
    texts: string[],
    taskType: EmbeddingTaskType,
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    if (getEmbeddingProvider(this.config) === "GOOGLE") {
      return this.embedWithGoogle(texts, taskType);
    }

    return this.embedWithOpenAi(texts);
  }

  private async embedWithOpenAi(texts: string[]): Promise<number[][]> {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!hasConfiguredSecret(apiKey)) {
      throw new Error("OPENAI_API_KEY is not set — cannot generate embeddings");
    }

    const embedder = new OpenAIEmbeddings({
      apiKey,
      model: getEmbeddingModel(this.config),
    });

    return embedder.embedDocuments(texts);
  }

  private async embedWithGoogle(
    texts: string[],
    taskType: EmbeddingTaskType,
  ): Promise<number[][]> {
    const apiKey = this.config.get<string>("GOOGLE_API_KEY");
    if (!hasConfiguredSecret(apiKey)) {
      throw new Error("GOOGLE_API_KEY is not set — cannot generate embeddings");
    }

    const client = new GoogleGenAI({ apiKey });
    const model = getEmbeddingModel(this.config);
    const outputDimensionality = getEmbeddingDimensions(this.config);

    return Promise.all(
      texts.map(async (text) => {
        const response = await client.models.embedContent({
          model,
          contents: text,
          config: {
            taskType,
            outputDimensionality,
          },
        });

        const vector = response.embeddings?.[0]?.values;
        if (!vector || vector.length === 0) {
          throw new Error(`Google embedding response was empty for model ${model}`);
        }

        return vector;
      }),
    );
  }

  private async embedPdfWithGoogle(pdfBuffers: Buffer[]): Promise<number[][]> {
    const apiKey = this.config.get<string>("GOOGLE_API_KEY");
    if (!hasConfiguredSecret(apiKey)) {
      throw new Error("GOOGLE_API_KEY is not set — cannot generate embeddings");
    }

    const client = new GoogleGenAI({ apiKey });
    const model = getEmbeddingModel(this.config);
    const outputDimensionality = getEmbeddingDimensions(this.config);

    return Promise.all(
      pdfBuffers.map(async (buffer) => {
        const response = await client.models.embedContent({
          model,
          contents: [createPartFromBase64(buffer.toString("base64"), "application/pdf")],
          config: {
            taskType: "RETRIEVAL_DOCUMENT",
            outputDimensionality,
          },
        });

        const vector = response.embeddings?.[0]?.values;
        if (!vector || vector.length === 0) {
          throw new Error(`Google PDF embedding response was empty for model ${model}`);
        }

        return vector;
      }),
    );
  }
}
