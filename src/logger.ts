import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  serializers:{err:(error)=>JSON.parse(JSON.stringify(pino.stdSerializers.err(error)).replace(/gsk_[A-Za-z0-9]{15,}|sk-proj-[A-Za-z0-9_-]{15,}|\d{8,12}:[A-Za-z0-9_-]{25,}/g,'[REDACTED]'))},
  level: config.logLevel,
  ...(config.isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }),
});

export function moduleLogger(module: string) {
  return logger.child({ module });
}
