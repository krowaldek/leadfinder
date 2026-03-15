export interface TokenUsageLike {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiOperationLog {
  name: string;
  provider: "OPENAI" | "GOOGLE";
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  currency: "USD";
}

const OPENAI_MODEL_PRICING_USD_PER_1M: Record<
  string,
  { input: number; output: number }
> = {
  "gpt-5-mini": { input: 0.15, output: 0.6 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

function roundUsd(value: number): number {
  return Number(value.toFixed(6));
}

export function estimateAiOperationCostUsd(input: {
  provider: "OPENAI" | "GOOGLE";
  model: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}): number | null {
  if (input.provider !== "OPENAI") {
    return null;
  }

  const pricing = OPENAI_MODEL_PRICING_USD_PER_1M[input.model];
  if (!pricing) {
    return null;
  }

  const promptTokens = Number(input.promptTokens ?? input.totalTokens ?? 0);
  const completionTokens = Number(input.completionTokens ?? 0);

  return roundUsd(
    (promptTokens / 1_000_000) * pricing.input +
      (completionTokens / 1_000_000) * pricing.output,
  );
}

export function buildAiOperationLog(input: {
  name: string;
  provider: "OPENAI" | "GOOGLE";
  model: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}): AiOperationLog {
  return {
    name: input.name,
    provider: input.provider,
    model: input.model,
    promptTokens:
      input.promptTokens != null ? Number(input.promptTokens) : null,
    completionTokens:
      input.completionTokens != null ? Number(input.completionTokens) : null,
    totalTokens: input.totalTokens != null ? Number(input.totalTokens) : null,
    estimatedCostUsd: estimateAiOperationCostUsd(input),
    currency: "USD",
  };
}
