import { spawnSync } from "node:child_process"

interface RunOpts {
  cwd?: string
  env?: NodeJS.ProcessEnv
}

// Run a subprocess, inheriting stdio, and throw on failure. Used for the system
// tools the pipeline shells out to: unzip, ffmpeg, `uv run transcribe.py`, and
// the downstream rebuild hook.
export function run(cmd: string, args: string[], opts: RunOpts = {}): void {
  const res = spawnSync(cmd, args, { stdio: "inherit", cwd: opts.cwd, env: opts.env })
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
