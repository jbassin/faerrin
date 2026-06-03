// Minimal timestamped logger. Keeps pipeline runs legible and gives reliability
// steps (retries, skipped sessions) a consistent place to report.

function ts(): string {
  return new Date().toISOString()
}

export const log = {
  info: (msg: string) => console.log(`[${ts()}] ${msg}`),
  warn: (msg: string) => console.warn(`[${ts()}] WARN  ${msg}`),
  error: (msg: string) => console.error(`[${ts()}] ERROR ${msg}`),
}
