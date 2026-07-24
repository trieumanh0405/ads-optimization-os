import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secret-crypto";

describe("AI provider secret encryption", () => {
  it("round trips without storing plaintext", () => {
    const secret = "a-very-long-server-side-encryption-secret";
    const encrypted = encryptSecret("sk-sensitive-value", secret);
    expect(encrypted).not.toContain("sk-sensitive-value");
    expect(decryptSecret(encrypted, secret)).toBe("sk-sensitive-value");
  });
});
