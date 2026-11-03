import { Api, InputFile, type Transformer } from "grammy";
import type { Message } from "grammy/types";
import { config, telegramFileUrl } from "../config.js";
import { one, query } from "../db/pool.js";
import { decryptBotToken } from "./bot-vault.js";
import { tokenForApi } from "./bot-runtime.js";
import { ReadCache } from "./read-cache.js";
const sources = new ReadCache(5000),
  converted = new ReadCache(3000),
  seen = new Set<string>();
const fields = [
  "photo",
  "video",
  "animation",
  "document",
  "audio",
  "voice",
  "video_note",
] as const;
export async function rememberMedia(
  message: Message | undefined,
  botId: number,
  chatId: number,
) {
  if (!message) return;
  const ids = fields.flatMap((f) => {
    const value = message[f];
    return Array.isArray(value)
      ? value.map((p) => p.file_id)
      : value && "file_id" in value
        ? [value.file_id]
        : [];
  });
  for (const fileId of ids) {
    if (seen.has(fileId)) continue;
    await query(
      "INSERT INTO media_sources(file_id,bot_id,chat_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [fileId, botId, chatId],
    );
    sources.invalidate(fileId);
    if (seen.size >= 5000) seen.delete(seen.values().next().value!);
    seen.add(fileId);
  }
}
async function sourceToken(botId: number): Promise<string> {
  if (botId === Number(config.botToken.split(":")[0])) return config.botToken;
  const row = await one<{ id: string; token_ciphertext: string }>(
    "SELECT id,token_ciphertext FROM branded_bots WHERE bot_id=$1",
    [botId],
  );
  if (!row) throw new Error("Vuelve a guardar este medio desde el bot actual.");
  return decryptBotToken(row.token_ciphertext, row.id);
}
async function transferable(fileId: string, sourceId: number) {
  try {
    const token = await sourceToken(sourceId),
      file = await new Api(
        token,
        {timeoutSeconds:10,...(config.telegramApiUrl?{apiRoot:config.telegramApiUrl}:{})},
      ).getFile(fileId);
    if (!file.file_path || (file.file_size ?? 0) > 10 * 1024 * 1024)
      throw new Error();
    const response = await fetch(telegramFileUrl(file.file_path, token), {
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (
      !response.ok ||
      Number(response.headers.get("content-length") ?? 0) > 10 * 1024 * 1024
    )
      throw new Error();
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        size += r.value.length;
        if (size > 10 * 1024 * 1024) throw new Error();
        chunks.push(r.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return new InputFile(
      Buffer.concat(chunks),
      file.file_path.split("/").at(-1) || "media",
    );
  } catch {
    throw new Error(
      "No se pudo trasladar este medio. Guárdalo de nuevo desde el bot actual (máximo 10 MB para traslado automático).",
    );
  }
}
export function mediaBridge(api: Api, botId: number): Transformer {
  return async (next, method, payload, signal) => {
    const p = payload as Record<string, unknown>,
      field = fields.find(
        (f) => method.toLowerCase() === "send" + f.replace("_", ""),
      );
    const original = field ? p[field] : null;
    if (!field || typeof original !== "string" || /^https?:/.test(original))
      return next(method, payload, signal);
    const source = await sources.get(
      original,
      600000,
      async () =>
        (await one<{ bot_id: number }>(
          "SELECT bot_id FROM media_sources WHERE file_id=$1",
          [original],
        )) ?? { bot_id: Number(config.botToken.split(":")[0]) },
      original,
    );
    if (source.bot_id === botId) return next(method, payload, signal);
    const cached = await converted.get(
      botId + ":" + original,
      600000,
      () =>
        one<{ file_id: string }>(
          "SELECT file_id FROM media_bridge_cache WHERE bot_id=$1 AND source_file_id=$2",
          [botId, original],
        ),
      undefined,
      (v) => v !== null,
    );
    const changed = {
      ...p,
      [field]: cached?.file_id ?? (await transferable(original, source.bot_id)),
    };
    const result = await next(method, changed as typeof payload, signal);
    if (result.ok && typeof result.result === "object" && result.result) {
      const message = result.result as Message;
      await rememberMedia(message, botId, Number(p.chat_id));
      const value = message[field];
      const id = Array.isArray(value)
        ? value.at(-1)?.file_id
        : value && "file_id" in value
          ? value.file_id
          : null;
      if (id) {
        await query(
          "INSERT INTO media_bridge_cache(bot_id,source_file_id,file_id) VALUES($1,$2,$3) ON CONFLICT(bot_id,source_file_id) DO UPDATE SET file_id=EXCLUDED.file_id",
          [botId, original, id],
        );
      }
    }
    return result;
  };
}
export function fileUrlForApi(api: Api, filePath: string) {
  return telegramFileUrl(filePath, tokenForApi(api) ?? config.botToken);
}
