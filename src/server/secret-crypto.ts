import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

const HKDF_SALT = Buffer.from("ads-optimization-os-v2", "utf8");
const HKDF_INFO = Buffer.from("aes-256-gcm-key", "utf8");

function legacyKey(secret: string): Buffer {
  if (secret.length < 32) throw new Error("PROVIDER_KEY_ENCRYPTION_SECRET_MUST_BE_AT_LEAST_32_CHARS");
  return createHash("sha256").update(secret).digest();
}

function key(secret: string): Buffer {
  if (secret.length < 32) throw new Error("PROVIDER_KEY_ENCRYPTION_SECRET_MUST_BE_AT_LEAST_32_CHARS");
  return Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, 32));
}

export function encryptSecret(value: string, secret = process.env.PROVIDER_KEY_ENCRYPTION_SECRET ?? ""): string {
  const k = key(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2.${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
}

export function decryptSecret(payload: string, secret = process.env.PROVIDER_KEY_ENCRYPTION_SECRET ?? ""): string {
  const parts = payload.split(".");
  const version = parts[0];
  const [, ivStr, tagStr, cipherStr] = parts;

  if ((version !== "v1" && version !== "v2") || !ivStr || !tagStr || !cipherStr) {
    throw new Error("ENCRYPTED_SECRET_FORMAT_INVALID");
  }

  const derivedKey = version === "v1" ? legacyKey(secret) : key(secret);
  const encoding = version === "v1" ? "base64url" : "hex";

  const decipher = createDecipheriv("aes-256-gcm", derivedKey, Buffer.from(ivStr, encoding));
  decipher.setAuthTag(Buffer.from(tagStr, encoding));
  return Buffer.concat([decipher.update(Buffer.from(cipherStr, encoding)), decipher.final()]).toString("utf8");
}

