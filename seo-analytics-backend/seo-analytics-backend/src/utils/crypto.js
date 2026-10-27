import crypto from "node:crypto";
import { env } from "../config/env.js";

const algorithm = "aes-256-gcm";
const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY_HEX, "hex");

export function encryptSecret(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptSecret(payload) {
  if (!payload) return null;
  const [version, iv64, tag64, ciphertext64] = payload.split(".");
  if (version !== "v1" || !iv64 || !tag64 || !ciphertext64) {
    throw new Error("Stored encrypted token has an unsupported format.");
  }
  const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(iv64, "base64"));
  decipher.setAuthTag(Buffer.from(tag64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext64, "base64")),
    decipher.final()
  ]).toString("utf8");
}
