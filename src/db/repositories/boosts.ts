import { one } from "../pool.js";

export async function addBoost(
  chatId: number,
  boostId: string,
  userId: number | null,
): Promise<void> {
  await one(
    `INSERT INTO chat_boosts (chat_id, boost_id, user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (chat_id, boost_id) DO NOTHING
     RETURNING boost_id`,
    [chatId, boostId, userId],
  );
  await syncBoostCount(chatId);
}

export async function removeBoost(chatId: number, boostId: string): Promise<void> {
  await one(
    "DELETE FROM chat_boosts WHERE chat_id = $1 AND boost_id = $2 RETURNING boost_id",
    [chatId, boostId],
  );
  await syncBoostCount(chatId);
}

export async function countBoosts(chatId: number): Promise<number> {
  const row = await one<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM chat_boosts WHERE chat_id = $1",
    [chatId],
  );
  return row?.total ?? 0;
}

async function syncBoostCount(chatId: number): Promise<void> {
  await one(
    `UPDATE chats
        SET boosts = (SELECT COUNT(*)::int FROM chat_boosts WHERE chat_id = $1),
            updated_at = now()
      WHERE chat_id = $1
      RETURNING chat_id`,
    [chatId],
  );
}
