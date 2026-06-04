import { spawnSync } from "node:child_process"

// Run a subprocess, inheriting stdio, and throw on failure. Used for the system
// tools the pipeline shells out to: unzip, ffmpeg, and `uv run transcribe.py`.
export function run(cmd: string, args: string[], opts: { cwd?: string } = {}): void {
  const res = spawnSync(cmd, args, { stdio: "inherit", cwd: opts.cwd })
  if (res.error) throw res.error
  if (res.status !== 0) {
    throw new Error(`${cmd} exited with status ${res.status ?? "signal " + res.signal}`)
  }
}

// Run a subprocess quietly and report only success/failure. Used for the
// readiness probe (`unzip -t`) where the exit code is the whole answer.
export function runOk(cmd: string, args: string[], opts: { cwd?: string } = {}): boolean {
  const res = spawnSync(cmd, args, { stdio: "ignore", cwd: opts.cwd })
  return !res.error && res.status === 0
}
