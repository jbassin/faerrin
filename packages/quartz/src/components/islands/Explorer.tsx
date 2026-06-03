/**
 * Explorer "Looking Glass" — Solid reactive port of explorer.inline.ts +
 * Explorer.tsx. Quartz built the tree client-side from fetchData + a serialized
 * sort/filter/map machinery (new Function); we build it at BUILD TIME
 * (buildExplorerTree in site.ts) and pass it as a prop, then render a recursive
 * Solid tree with per-folder collapse signals. Mounted client:only (Quartz's
 * explorer is also empty server-side and JS-built), so localStorage is available.
 *
 * Default behavior matches Explorer.tsx defaultOptions: folderClickBehavior
 * "link" (folder titles link to the folder, the chevron toggles collapse),
 * folderDefaultState "collapsed", useSavedState true. Folders that prefix the
 * current slug auto-open. Files get .active when they are the current page.
 */
import { For, createSignal, onCleanup, onMount } from "solid-js"
import { resolveRelative, simplifySlug } from "../../../scripts/lib/slug.ts"

interface TreeNode {
  slug: string
  displayName: string
  isFolder: boolean
  children: TreeNode[]
}

interface Props {
  tree: TreeNode[]
  currentSlug: string
  title?: string
}

type SavedState = { path: string; collapsed: boolean }

function loadSaved(): Map<string, boolean> {
  try {
    const raw = localStorage.getItem("fileTree")
    if (!raw) return new Map()
    return new Map((JSON.parse(raw) as SavedState[]).map((e) => [e.path, e.collapsed]))
  } catch {
    return new Map()
  }
}

function persist(map: Map<string, boolean>) {
  try {
    const arr: SavedState[] = [...map.entries()].map(([path, collapsed]) => ({ path, collapsed }))
    localStorage.setItem("fileTree", JSON.stringify(arr))
  } catch {
    /* ignore */
  }
}

export default function Explorer(props: Props) {
  const saved = loadSaved()
  const [collapsedExplorer, setCollapsedExplorer] = createSignal(false)

  const isPrefixOfCurrent = (folderPath: string) => {
    // Segment-boundary match (not raw string prefix) so "Foo" doesn't auto-open
    // when the current page is a sibling like "Foo-Bar/baz".
    const simple = simplifySlug(folderPath as any)
    return props.currentSlug === simple || props.currentSlug.startsWith(simple + "/")
  }

  const Node = (p: { node: TreeNode }) => {
    const n = p.node
    if (!n.isFolder) {
      return (
        <li>
          <a
            href={resolveRelative(props.currentSlug as any, n.slug as any)}
            data-for={n.slug}
            classList={{ active: n.slug === props.currentSlug }}
          >
            {n.displayName}
          </a>
        </li>
      )
    }

    const savedCollapsed = saved.get(n.slug)
    const initiallyOpen =
      (savedCollapsed === undefined ? false : !savedCollapsed) || isPrefixOfCurrent(n.slug)
    const [open, setOpen] = createSignal(initiallyOpen)

    const toggle = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const next = !open()
      setOpen(next)
      saved.set(n.slug, !next) // store collapsed = !open
      persist(saved)
    }

    return (
      <li>
        <div class="folder-container" data-folderpath={n.slug}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="5 8 14 8"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="folder-icon"
            onClick={toggle}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <div>
            <a
              href={resolveRelative(props.currentSlug as any, n.slug as any)}
              data-for={n.slug}
              class="folder-title"
            >
              {n.displayName}
            </a>
          </div>
        </div>
        <div classList={{ "folder-outer": true, open: open() }}>
          <ul>
            <For each={n.children}>{(child) => <Node node={child} />}</For>
          </ul>
        </div>
      </li>
    )
  }

  onMount(() => {
    // Collapse on mobile by default (matches the nav handler in explorer.inline.ts).
    const mq = window.matchMedia("(max-width: 800px)")
    if (mq.matches) setCollapsedExplorer(true)
    const onResize = () => {
      if (!mq.matches) document.documentElement.classList.remove("mobile-no-scroll")
    }
    window.addEventListener("resize", onResize)
    onCleanup(() => window.removeEventListener("resize", onResize))
  })

  const toggleExplorer = () => {
    const next = !collapsedExplorer()
    setCollapsedExplorer(next)
    document.documentElement.classList.toggle("mobile-no-scroll", !next)
  }

  return (
    <div
      classList={{ explorer: true, collapsed: collapsedExplorer() }}
      aria-expanded={!collapsedExplorer()}
    >
      <button
        type="button"
        class="explorer-toggle mobile-explorer"
        aria-label="Toggle Explorer"
        onClick={toggleExplorer}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
          class="lucide-menu"
        >
          <line x1="4" x2="20" y1="12" y2="12" />
          <line x1="4" x2="20" y1="6" y2="6" />
          <line x1="4" x2="20" y1="18" y2="18" />
        </svg>
      </button>
      <button
        type="button"
        class="title-button explorer-toggle desktop-explorer"
        onClick={toggleExplorer}
      >
        <h2>{props.title ?? "Explorer"}</h2>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="5 8 14 8"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="fold"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div class="explorer-content" role="group">
        <ul class="explorer-ul">
          <For each={props.tree}>{(node) => <Node node={node} />}</For>
        </ul>
      </div>
    </div>
  )
}
