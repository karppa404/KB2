import Perplexity from "@perplexity-ai/perplexity_ai";

export interface PerplexityResult {
  answer: string;
  citations: string[];
}

let client: Perplexity | null = null;

function getClient(): Perplexity {
  if (!client) {
    client = new Perplexity();
  }
  return client;
}

export async function searchPerplexity(
  query: string,
  opts?: {
    model?: string;
    maxTokens?: number;
  },
): Promise<PerplexityResult> {
  const response = await getClient().chat.completions.create({
    model: opts?.model ?? "sonar",
    max_tokens: opts?.maxTokens ?? 1000,
    messages: [{ role: "user", content: query }],
  });

  const rawContent = response.choices?.[0]?.message?.content;
  const answer =
    typeof rawContent === "string"
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent
            .map((chunk) => {
              const candidate = chunk as { text?: string };
              return candidate.text ?? "";
            })
            .filter(Boolean)
            .join("\n")
        : "";
  const citations = (response as { citations?: string[] }).citations ?? [];

  return { answer, citations };
}
