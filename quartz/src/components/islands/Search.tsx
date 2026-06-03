/**
 * Search — Solid island over Pagefind (replaces Quartz's FlexSearch, per plan §5,
 * §8 risk 5: "an upgrade, not a port"). Reproduces the sidebar trigger + modal UX
 * of Search.tsx (.search-button → .search-container.active, Ctrl/Cmd+K to open,
 * Escape to close) but delegates indexing/snippets to Pagefind's static index
 * (built into dist/pagefind by astro-pagefind). The Pagefind runtime is
 * lazy-imported on first open so reading pages ship zero search JS.
 *
 * The live-preview pane is dropped for v1 (acceptable per §8). NOTE: Pagefind
 * indexes BUILT html, so search is empty under `astro dev` until a build — use
 * the `dev:search` recipe (build + preview).
 */
import { For, createSignal, onCleanup, onMount } from "solid-js"

interface PFResult {
  url: string
  meta: { title?: string }
  excerpt: string
}

export default function Search() {
  const [open, setOpen] = createSignal(false)
  const [results, setResults] = createSignal<PFResult[]>([])
  let inputRef: HTMLInputElement | undefined
  let pagefind: any = null
  let timer: number | undefined
  let searchToken = 0

  const ensurePagefind = async () => {
    if (pagefind) return pagefind
    // /pagefind/pagefind.js is emitted by the Pagefind build step. Built from a
    // variable (not a literal) so Rollup can't try to resolve it at build time —
    // it's a runtime asset that only exists in dist/.
    const pagefindPath = "/pagefind/pagefind.js"
    pagefind = await import(/* @vite-ignore */ pagefindPath)
    await pagefind.options?.({ excerptLength: 25 })
    pagefind.init?.()
    return pagefind
  }

  const openSearch = async () => {
    setOpen(true)
    await ensurePagefind().catch(() => {})
    queueMicrotask(() => inputRef?.focus())
  }
  const closeSearch = () => {
    setOpen(false)
    setResults([])
    if (inputRef) inputRef.value = ""
  }

  const runSearch = async (q: string) => {
    const token = ++searchToken // discard out-of-order / post-close responses
    if (!q || q.trim().length < 1) {
      setResults([])
      return
    }
    const pf = await ensurePagefind().catch(() => null)
    if (!pf || token !== searchToken) return
    const res = await pf.search(q.trim())
    const data: PFResult[] = await Promise.all(res.results.slice(0, 20).map((r: any) => r.data()))
    if (token !== searchToken || !open()) return
    setResults(data)
  }

  const onInput = (e: InputEvent) => {
    const q = (e.currentTarget as HTMLInputElement).value
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void runSearch(q), 180)
  }

  onMount(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        open() ? closeSearch() : void openSearch()
      } else if (e.key === "Escape" && open()) {
        closeSearch()
      }
    }
    document.addEventListener("keydown", onKeydown)
    onCleanup(() => document.removeEventListener("keydown", onKeydown))
  })

  return (
    <div class="search">
      <button class="search-button" type="button" onClick={() => void openSearch()}>
        <p>Search</p>
        <svg viewBox="0 0 512 512" width="18" height="18" aria-hidden="true">
          <path
            class="search-path"
            fill="none"
            d="M504 480L348 324a204 204 0 1 0-24 24l156 156zM52 212a160 160 0 1 1 320 0 160 160 0 0 1-320 0z"
          />
        </svg>
      </button>

      <div
        classList={{ "search-container": true, active: open() }}
        onClick={(e) => {
          if (e.currentTarget === e.target) closeSearch()
        }}
      >
        <div class="search-space">
          <input
            ref={inputRef}
            type="text"
            autocomplete="off"
            class="search-bar"
            placeholder="Search"
            aria-label="Search"
            onInput={onInput}
          />
          <div classList={{ "search-layout": true, "display-results": results().length > 0 }}>
            <div class="results-container">
              <For each={results()}>
                {(r) => (
                  <a class="result-card" href={r.url.replace(/\.html$/, "")}>
                    <h3>{r.meta.title ?? r.url}</h3>
                    <p innerHTML={r.excerpt} />
                  </a>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
