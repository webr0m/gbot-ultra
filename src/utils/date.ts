import {botLanguage} from '../services/bot-i18n.js';
import { config } from "../config.js";

export function todayInTimeZone(timeZone = config.timezone): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function formatDate(date: Date, timeZone = config.timezone): string {
  return new Intl.DateTimeFormat(botLanguage(), {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(date: Date, timeZone = config.timezone): string {
  return new Intl.DateTimeFormat(botLanguage(), {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatTime(date: Date, timeZone = config.timezone): string {
  return new Intl.DateTimeFormat(botLanguage(), {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

export function dateOffset(days: number, from = new Date()): string {
  return todayInTimeZoneOffset(days, from);
}

function todayInTimeZoneOffset(days: number, from: Date): string {
  const date = new Date(from.getTime() + days * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}
