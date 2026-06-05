// ANSI color helpers for terminal output. Colors are emitted only when stdout is a
// TTY and NO_COLOR is unset (https://no-color.org), so piped/redirected output, CI,
// and tests stay plain text — string assertions on rendered output keep matching.

const enabled = process.stdout.isTTY === true && !process.env.NO_COLOR

function sgr(open: number, close: number): (s: string) => string {
  return (s: string): string => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s)
}

export const color = {
  bold: sgr(1, 22),
  dim: sgr(2, 22),
  red: sgr(31, 39),
  green: sgr(32, 39),
  yellow: sgr(33, 39),
  blue: sgr(34, 39),
  magenta: sgr(35, 39),
  cyan: sgr(36, 39),
  gray: sgr(90, 39),
}
