import { aiInsightSchema, type AiProvider } from "./contracts";

export class OpenAiCompatibleProvider implements AiProvider {
  constructor(
    public readonly id: string,
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async analyze(input: {
    model: string;
    systemPrompt: string;
    payload: unknown;
  }) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: JSON.stringify(input.payload) }
        ]
      })
    });

    if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI provider returned an empty response");
    return aiInsightSchema.parse(JSON.parse(content));
  }
}
