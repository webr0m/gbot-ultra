import { config } from "../config.js";

export const FREE_COMMANDS = 3;
export const PREMIUM_COMMANDS = 50;
export const FREE_NOTES = 5;
export const PREMIUM_NOTES = 100;

export function commandLimit(premium: boolean): number {
  return premium ? PREMIUM_COMMANDS : FREE_COMMANDS;
}

export function noteLimit(premium: boolean): number {
  return premium ? PREMIUM_NOTES : FREE_NOTES;
}

export function actionLimit(premium: boolean): number {
  return premium ? config.premiumActionLimit : config.freeActionLimit;
}
