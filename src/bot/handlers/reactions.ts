import type { Bot } from 'grammy';
import type { AppContext } from '../context.js';
import { handleReactionReport } from '../../services/reaction-reports.js';
import { logger } from '../../logger.js';
import { tr } from '../../services/bot-i18n.js';

export function registerReactionHandlers(bot: Bot<AppContext>): void {
  bot.on('message_reaction', async (ctx) => {
    const update = ctx.update.message_reaction;
    const chatRow = ctx.app.chatRow;
    if (!update || !chatRow) return;
    try {
      await handleReactionReport(ctx.api, chatRow, update);
    } catch (error) {
      logger.warn({ err: error, chatId: update.chat.id }, tr("No se pudo registrar el reporte por reacción"));
    }
  });
}
