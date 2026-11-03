import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
} from "node:crypto";
import { config } from "../config.js";
function vaultKey() {
  const key = Buffer.from(config.botVaultKey, "base64");
  if (key.length !== 32)
    throw Object.assign(
      new Error("El almacén privado de bots no está configurado."),
      { statusCode: 503 },
    );
  return key;
}
export function vaultConfigured() {
  try {
    vaultKey();
    return true;
  } catch {
    return false;
  }
}
export function encryptBotToken(token: string, identity: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", vaultKey(), iv);
  cipher.setAAD(Buffer.from(identity));
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((v) => v.toString("base64"))
    .join(".");
}
export function decryptBotToken(value: string, identity: string) {
  const [iv, tag, payload] = value
    .split(".")
    .map((s) => Buffer.from(s, "base64"));
  if (!iv || !tag || !payload) throw new Error("Credencial privada inválida");
  const cipher = createDecipheriv("aes-256-gcm", vaultKey(), iv);
  cipher.setAAD(Buffer.from(identity));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(payload), cipher.final()]).toString(
    "utf8",
  );
}
export function brandedWebhookSecret(id: string) {
  return createHmac("sha256", vaultKey())
    .update("gbot-brand-webhook:" + id)
    .digest("hex");
}
