import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { HttpError } from "../utils/http-error.js";

const BCRYPT_COST = 12;

export function assertPassword(password) {
  if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    throw new HttpError(422, "Password must be at least 12 characters and no more than 72 UTF-8 bytes.", "VALIDATION_ERROR");
  }
}

export function createTemporaryPassword() {
  return crypto.randomBytes(24).toString("base64url");
}

export function hashPassword(password) {
  assertPassword(password);
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}
