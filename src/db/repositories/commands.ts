import { many, one } from "../pool.js";
import type { CustomCommandRow, NoteRow } from "../types.js";

// ------------------------------------------------------------
//  Comandos personalizados
// ------------------------------------------------------------

export async function listCustomCommands(chatId: number): Promise<CustomCommandRow[]> {
  return many<CustomCommandRow>(
    "SELECT * FROM custom_commands WHERE chat_id = $1 ORDER BY name ASC",
    [chatId],
  );
}

export async function getCustomCommand(
  chatId: number,
  name: string,
): Promise<CustomCommandRow | null> {
  return one<CustomCommandRow>(
    "SELECT * FROM custom_commands WHERE chat_id = $1 AND name = lower($2)",
    [chatId, name],
  );
}

export async function upsertCustomCommand(
  chatId: number,
  name: string,
  content: string,
  createdBy: number,
): Promise<CustomCommandRow> {
  const row = await one<CustomCommandRow>(
    `INSERT INTO custom_commands (chat_id, name, content, created_by)
     VALUES ($1, lower($2), $3, $4)
     ON CONFLICT (chat_id, name) DO UPDATE SET
       content = EXCLUDED.content,
       created_by = EXCLUDED.created_by
     RETURNING *`,
    [chatId, name, content, createdBy],
  );
  return row!;
}

export async function deleteCustomCommand(chatId: number, name: string): Promise<boolean> {
  const row = await one<{ name: string }>(
    "DELETE FROM custom_commands WHERE chat_id = $1 AND name = lower($2) RETURNING name",
    [chatId, name],
  );
  return Boolean(row);
}

export async function incrementCustomCommandUses(chatId: number, name: string): Promise<void> {
  await one(
    `UPDATE custom_commands SET uses = uses + 1
      WHERE chat_id = $1 AND name = lower($2) RETURNING name`,
    [chatId, name],
  );
}

export async function countCustomCommands(chatId: number): Promise<number> {
  const row = await one<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM custom_commands WHERE chat_id = $1",
    [chatId],
  );
  return row?.total ?? 0;
}

// ------------------------------------------------------------
//  Notas
// ------------------------------------------------------------

export async function listNotes(chatId: number): Promise<NoteRow[]> {
  return many<NoteRow>(
    "SELECT * FROM notes WHERE chat_id = $1 ORDER BY name ASC",
    [chatId],
  );
}

export async function getNote(chatId: number, name: string): Promise<NoteRow | null> {
  return one<NoteRow>(
    "SELECT * FROM notes WHERE chat_id = $1 AND name = lower($2)",
    [chatId, name],
  );
}

export async function upsertNote(
  chatId: number,
  name: string,
  content: string,
  createdBy: number,
): Promise<NoteRow> {
  const row = await one<NoteRow>(
    `INSERT INTO notes (chat_id, name, content, created_by)
     VALUES ($1, lower($2), $3, $4)
     ON CONFLICT (chat_id, name) DO UPDATE SET
       content = EXCLUDED.content,
       created_by = EXCLUDED.created_by
     RETURNING *`,
    [chatId, name, content, createdBy],
  );
  return row!;
}

export async function deleteNote(chatId: number, name: string): Promise<boolean> {
  const row = await one<{ name: string }>(
    "DELETE FROM notes WHERE chat_id = $1 AND name = lower($2) RETURNING name",
    [chatId, name],
  );
  return Boolean(row);
}

export async function incrementNoteUses(chatId: number, name: string): Promise<void> {
  await one(
    `UPDATE notes SET uses = uses + 1
      WHERE chat_id = $1 AND name = lower($2) RETURNING name`,
    [chatId, name],
  );
}

export async function countNotes(chatId: number): Promise<number> {
  const row = await one<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM notes WHERE chat_id = $1",
    [chatId],
  );
  return row?.total ?? 0;
}
