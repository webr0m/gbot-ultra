import type { Api } from 'grammy';
import type { ChatRow } from '../db/types.js';
import { config } from '../config.js';
import { logModeration } from '../db/repositories/moderation.js';
import { advancedConfig, effectiveAdvanced, trustedScopes } from './advanced-config.js';
import { hasFeature } from './entitlements.js';
import { memberMutation } from './sanction-journal.js';
import { withFreshTelegramReads } from './telegram-cache.js';
import { tr } from './bot-i18n.js';

const MEDIA_PERMISSIONS = {
  can_send_audios: false, can_send_documents: false, can_send_photos: false,
  can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false,
  can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false,
};

export async function applyMemberProbation(api: Api, chat: ChatRow, userId: number, joinedAt: number): Promise<void> {
  if (chat.type !== 'supergroup' || config.ownerIds.has(userId)) return;
  const saved = await advancedConfig(chat.chat_id);
  const { probation, observation } = effectiveAdvanced(chat, saved.settings, saved.actorId);
  const until = joinedAt + probation.minutes * 60;
  if (!probation.enabled || until - Math.floor(Date.now() / 1000) < 35) return;
  if (hasFeature(chat, 'trust', saved.actorId) && (await trustedScopes(chat.chat_id, userId)).includes('locks')) return;

  await memberMutation(chat.chat_id, userId, () => withFreshTelegramReads(async () => {
    const member = await api.getChatMember(chat.chat_id, userId);
    if (member.status !== 'member') return;
    if (!observation.enabled) {
      const group = await api.getChat(chat.chat_id);
      if (group.type !== 'supergroup' || !group.permissions) return;
      if (!Object.keys(MEDIA_PERMISSIONS).some(key => group.permissions?.[key as keyof typeof MEDIA_PERMISSIONS])) return;
      await api.restrictChatMember(chat.chat_id, userId, { ...group.permissions, ...MEDIA_PERMISSIONS }, {
        use_independent_chat_permissions: true,
        until_date: until,
      });
    }
    await logModeration({ chatId: chat.chat_id, targetId: userId, action: observation.enabled ? 'observation' : 'member_probation',
      reason: tr('Periodo inicial sin contenido multimedia'), metadata: { until } });
  }));
}
