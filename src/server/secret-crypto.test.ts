import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secret-crypto";

describe("AI provider secret encryption", () => {
  it("round trips without storing plaintext", () => {
    const secret = "a-very-long-server-side-encryption-secret";
    const encrypted = encryptSecret("sk-sensitive-value", secret);
    expect(encrypted).not.toContain("sk-sensitive-value");
    expect(decryptSecret(encrypted, secret)).toBe("sk-sensitive-value");
  });

  it("encrypts using v2 format", () => {
    const secret = "a-very-long-server-side-encryption-secret";
    const encrypted = encryptSecret("sk-sensitive-value", secret);
    expect(encrypted.startsWith("v2.")).toBe(true);
  });

  it("decrypts legacy v1 encrypted payloads", () => {
    const secret = "a-very-long-server-side-encryption-secret";
    const legacyKey = createHash("sha256").update(secret).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", legacyKey, iv);
    const encrypted = Buffer.concat([cipher.update("legacy-secret-value", "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const v1Payload = ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");

    expect(decryptSecret(v1Payload, secret)).toBe("legacy-secret-value");
  });

  it("throws error when secret is less than 32 characters", () => {
    const shortSecret = "too-short";
    expect(() => encryptSecret("hello", shortSecret)).toThrow(
      "PROVIDER_KEY_ENCRYPTION_SECRET_MUST_BE_AT_LEAST_32_CHARS"
    );
    expect(() => decryptSecret("v2.iv.tag.cipher", shortSecret)).toThrow(
      "PROVIDER_KEY_ENCRYPTION_SECRET_MUST_BE_AT_LEAST_32_CHARS"
    );
  });
});

