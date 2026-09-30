import pino, { type Logger } from 'pino';

export type { Logger };

export interface LoggerOptions {
  service: string;
  level?: string;
  pretty?: boolean;
  silent?: boolean;
}

/** Pino JSON logger with the redactions every service needs (README stack table). */
export function createLogger(options: LoggerOptions): Logger {
  return pino({
    name: options.service,
    level: options.silent ? 'silent' : options.level ?? 'info',
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'token', 'refreshToken', 'accessToken', '*.password', '*.token'],
      censor: '[redacted]',
    },
    transport: options.pretty && !options.silent ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  });
}
