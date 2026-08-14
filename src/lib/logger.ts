export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogFields {
  [key: string]: unknown
}

function emit(level: LogLevel, message: string, fields?: LogFields) {
  const entry = JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...fields,
  })
  if (level === 'error' || level === 'warn') {
    console.error(entry)
  } else {
    console.log(entry)
  }
}

export const log = {
  debug: (message: string, fields?: LogFields) => emit('debug', message, fields),
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),
}
