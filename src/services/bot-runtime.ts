import { AsyncLocalStorage } from "node:async_hooks";
import type { Api, Bot } from "grammy";
import type { AppContext } from "../bot/context.js";
export type Runtime = {
  bot: Bot<AppContext>;
  token: string;
  chatId: number;
  id: string;
};
export const botExecution = new AsyncLocalStorage<Runtime>();
let primary: Bot<AppContext> | undefined;
const tokens = new WeakMap<object, string>();
export function rememberBotToken(api: Api, token: string) {
  tokens.set(api, token);
}
export function tokenForApi(api: Api): string | undefined {
  return tokens.get(api);
}
export function setPrimaryBot(bot: Bot<AppContext>) {
  primary = bot;
}
export function primaryBot() {
  if (!primary) throw new Error("Bot principal no disponible");
  return primary;
}
export function scopedBot(
  bot: Bot<AppContext>,
  routedApi: Api,
): Bot<AppContext> {
  return new Proxy(bot, {
    get(target, key) {
      const live = botExecution.getStore()?.bot ?? target;
      if (key === "api") return botExecution.getStore()?.bot.api ?? routedApi;
      if (key === "botInfo") return live.botInfo;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
