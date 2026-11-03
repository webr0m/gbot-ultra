import {botLanguage} from '../services/bot-i18n.js';
import { tr } from "../services/bot-i18n.js";
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function displayName(user: {
  first_name?: string;
  last_name?: string | null;
  username?: string | null;
}): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || user.username || tr("Usuario");
}

export function mentionUser(user: {
  id: number;
  first_name?: string;
  last_name?: string | null;
  username?: string | null;
}): string {
  const name = escapeHtml(displayName(user));
  return `<a href="tg://user?id=${user.id}">${name}</a>`;
}

export function userReference(user: {
  id: number;
  first_name?: string;
  last_name?: string | null;
  username?: string | null;
}): string {
  if (user.username) return `@${escapeHtml(user.username)}`;
  return mentionUser(user);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(botLanguage()).format(value);
}

export function truncate(value: string, max: number): string {
  const clean = value.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

export function starsLabel(amount: number): string {
  return `${formatNumber(amount)} ⭐`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}
