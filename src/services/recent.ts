const recent = new Map<number, number[]>();
const MAX_RECENT = 150;

export function rememberMessage(chatId: number, messageId: number): void {
  const list = recent.get(chatId) ?? [];
  list.push(messageId);
  if (list.length > MAX_RECENT) list.splice(0, list.length - MAX_RECENT);
  recent.set(chatId, list);
}

export function recentMessageIds(chatId: number, count: number): number[] {
  const list = recent.get(chatId) ?? [];
  const safe = Math.max(1, Math.min(count, list.length));
  return list.slice(list.length - safe);
}

export function clearRecent(chatId: number): void {
  recent.delete(chatId);
}
