import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(secret: string): Buffer {
  if (secret.length < 32) throw new Error("PROVIDER_KEY_ENCRYPTION_SECRET_MUST_BE_AT_LEAST_32_CHARS");
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string, secret = process.env.PROVIDER_KEY_ENCRYPTION_SECRET ?? ""): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, secret = process.env.PROVIDER_KEY_ENCRYPTION_SECRET ?? ""): string {
  const [version, iv, tag, encrypted] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("ENCRYPTED_SECRET_FORMAT_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
