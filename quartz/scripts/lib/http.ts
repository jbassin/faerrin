import { remote } from "../config"
import { log } from "./log"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetch JSON with a timeout and bounded retries. Throws after the final
 * attempt so callers can decide whether to skip the item or abort.
 */
export async function fetchJSON<T = unknown>(url: string): Promise<T> {
  let lastErr: unknown

  for (let attempt = 1; attempt <= remote.fetchRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), remote.fetchTimeoutMs)

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`)
      }
      return (await res.json()) as T
    } catch (err) {
      lastErr = err
      const reason = err instanceof Error ? err.message : String(err)
      if (attempt < remote.fetchRetries) {
        log.warn(
          `fetch ${url} failed (attempt ${attempt}/${remote.fetchRetries}): ${reason}; retrying`,
        )
        await sleep(remote.retryBackoffMs * attempt)
      } else {
        log.error(`fetch ${url} failed after ${remote.fetchRetries} attempts: ${reason}`)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastErr
}
