import pino from 'pino';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let rootLogger: pino.Logger | null = null;

export function initLogger(opts: { level: LogLevel; pretty: boolean }): pino.Logger {
  rootLogger = pino({
    level: opts.level,
    ...(opts.pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  });
  return rootLogger;
}

export function getLogger(name?: string): pino.Logger {
  if (!rootLogger) {
    rootLogger = pino({ level: 'info' });
  }
  return name ? rootLogger.child({ module: name }) : rootLogger;
}
