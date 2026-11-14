import type { Api } from 'grammy';
import type { MessageReactionUpdated } from '@grammyjs/types';
import { logger } from '../logger.js';
import { rememberReport } from './inbox.js';
import { logModeration } from '../db/repositories/moderation.js';
import { one } from '../db/pool.js';
import { runtimeAdvanced } from './advanced-engine.js';
import type { ChatRow } from '../db/types.js';

function reactionEmoji(reaction: MessageReactionUpdated['new_reaction'][number]): string | null {
  return reaction.type === 'emoji' ? reaction.emoji : null;
}

/**
 * A configured reaction acts as a report: the member stays anonymous to the
 * group and the entry lands in the review inbox.
 */
export async function handleReactionReport(api: Api, chat: ChatRow, update: MessageReactionUpdated): Promise<boolean> {
  const settings = (await runtimeAdvanced(chat)).reactions;
  if (!settings.reportEmoji) return false;
  const reporter = update.user;
  if (!reporter || reporter.is_bot) return false;
  const emoji = update.new_reaction.map(reactionEmoji).find(value => value === settings.reportEmoji);
  if (!emoji) return false;
  if (update.new_reaction.length === 0) return false;

  const stored = await rememberReport(chat.chat_id, reporter.id, update.message_id, undefined, undefined);
  if (!stored) return false;

  if (settings.autoDeleteAfter > 0) {
    const counted = await one<{ total: number }>(
      'SELECT COUNT(DISTINCT reporter_id)::int AS total FROM member_reports WHERE chat_id=$1 AND message_id=$2',
      [chat.chat_id, update.message_id]);
    if ((counted?.total ?? 0) >= settings.autoDeleteAfter) {
      try {
        await api.deleteMessage(chat.chat_id, update.message_id);
        await logModeration({ chatId: chat.chat_id, action: 'delete_reaction_reports',
          reason: 'Reporte por reacción', metadata: { messageId: update.message_id, reporters: counted?.total ?? 0 } });
      } catch (error) {
        logger.warn({ err: error, chatId: chat.chat_id, messageId: update.message_id }, 'No se pudo borrar el mensaje reportado por reacción');
      }
    }
  }
  return true;
}
