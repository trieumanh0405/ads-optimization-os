import { parseAiInsight, type AiProvider } from "./contracts";

type GeminiErrorPayload = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{ reason?: string; domain?: string }>;
  };
};

export function formatGeminiError(status: number, payload: unknown): string {
  const googleError = (payload as GeminiErrorPayload | null)?.error;
  const reason = googleError?.details?.find((item) => item.reason)?.reason;
  const parts = [
    `Gemini API ${status}`,
    googleError?.status,
    reason,
    googleError?.message
  ].filter(Boolean);
  return parts.join(" · ").slice(0, 700) || `Gemini API returned ${status}`;
}

export class GeminiProvider implements AiProvider {
  constructor(public readonly id: string, private readonly baseUrl: string, private readonly apiKey: string) {}
  async analyze(input: { model: string; systemPrompt: string; payload: unknown }) {
    const url = `${this.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(input.model)}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey
      },
      signal: AbortSignal.timeout(55_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(input.payload) }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      })
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      throw new Error(formatGeminiError(response.status, errorPayload));
    }
    const json = await response.json();
    const content = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error("AI provider returned an empty response");
    return parseAiInsight(content);
  }
}
