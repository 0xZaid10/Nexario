import pino from 'pino'
import { env } from '../config/env.js'

export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: { service: 'nexario' },
  redact: {
    paths: [
      'privateKey',
      'PRIVATE_KEY',
      '*.privateKey',
      'authorization',
      'Authorization',
      '*.signature',
    ],
    censor: '[REDACTED]',
  },
})

export function childLogger(module: string, context?: Record<string, unknown>) {
  return logger.child({ module, ...context })
}

export type Logger = typeof logger
