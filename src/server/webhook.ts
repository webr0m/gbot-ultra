import { logger } from '../logger.js';

const MAX_IN_FLIGHT = 12;

let inFlight = 0;
const waiting: (() => void)[] = [];

/**
 * Telegram waits for the webhook response; a slow update makes the origin miss
 * Cloudflare's timeout and Telegram records a 522/524 error. The receipt is
 * already stored, so the update is processed after the acknowledgement.
 */
export function runInBackground(task: () => Promise<void>): void {
  const start = async () => {
    inFlight += 1;
    try {
      await task();
    } catch (error) {
      logger.error({ err: error }, 'webhook background processing failed');
    } finally {
      inFlight -= 1;
      const next = waiting.shift();
      if (next) void next();
    }
  };
  if (inFlight >= MAX_IN_FLIGHT) waiting.push(start);
  else void start();
}
