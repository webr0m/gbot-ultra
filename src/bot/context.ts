import type { Context } from "grammy";
import type { ChatRow, GroupSettings } from "../db/types.js";

export interface AppData {
  botId: number;
  chatRow: ChatRow | null;
  settings: GroupSettings;
  premium: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  actorName: string;
  language?:string;
}

export type AppContext = Context & { app: AppData };
