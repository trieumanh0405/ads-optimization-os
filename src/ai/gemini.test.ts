import { describe, expect, it } from "vitest";
import { formatGeminiError } from "./gemini";

describe("Gemini provider diagnostics", () => {
  it("surfaces Google error status, reason and message", () => {
    expect(formatGeminiError(400, {
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        message: "API key not valid. Please pass a valid API key.",
        details: [{ reason: "API_KEY_INVALID", domain: "googleapis.com" }]
      }
    })).toBe("Gemini API 400 · INVALID_ARGUMENT · API_KEY_INVALID · API key not valid. Please pass a valid API key.");
  });

  it("falls back to the HTTP status when Google returns no JSON body", () => {
    expect(formatGeminiError(503, null)).toBe("Gemini API 503");
  });
});
