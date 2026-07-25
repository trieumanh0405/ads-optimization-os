import { parseAiInsight, type AiProvider } from "./contracts";

export class GeminiProvider implements AiProvider {
  constructor(public readonly id: string, private readonly baseUrl: string, private readonly apiKey: string) {}
  async analyze(input: { model: string; systemPrompt: string; payload: unknown }) {
    const url = `${this.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(55_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(input.payload) }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      })
    });
    if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
    const json = await response.json();
    const content = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error("AI provider returned an empty response");
    return parseAiInsight(content);
  }
}
