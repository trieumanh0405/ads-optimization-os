import { parseAiInsight, type AiProvider } from "./contracts";

export class AnthropicProvider implements AiProvider {
  constructor(public readonly id: string, private readonly baseUrl: string, private readonly apiKey: string) {}
  async analyze(input: { model: string; systemPrompt: string; payload: unknown }) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: input.model, max_tokens: 2500, temperature: 0.1, system: input.systemPrompt,
        messages: [{ role: "user", content: JSON.stringify(input.payload) }]
      })
    });
    if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
    const json = await response.json();
    const content = json.content?.find((item: { type?: string }) => item.type === "text")?.text;
    if (!content) throw new Error("AI provider returned an empty response");
    return parseAiInsight(content);
  }
}
