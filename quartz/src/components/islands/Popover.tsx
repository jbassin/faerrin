/**
 * Popover hover-previews — ported from quartz/components/scripts/popover.inline.ts
 * (+ fetchCanonical/normalizeRelativeURLs). Progressive-enhancement island: renders
 * nothing, binds mouseenter/leave on every `a.internal` in onMount. On hover it
 * fetches the target page, extracts its `.popover-hint` (every Astro page wraps
 * its body in one), prefixes inner ids to avoid dupes, and positions a floating
 * card with @floating-ui/dom. nav→onMount, addCleanup→onCleanup. §10.4 defers
 * this as a fast-follow; included here per the user's "all islands" choice.
 */
import { computePosition, flip, inline, shift } from "@floating-ui/dom"
import { onCleanup, onMount } from "solid-js"

const canonicalRegex = /<link rel="canonical" href="([^"]*)">/

async function fetchCanonical(url: URL): Promise<Response> {
  const res = await fetch(`${url}`)
  if (!res.headers.get("content-type")?.startsWith("text/html")) return res
  const text = await res.clone().text()
  const [, redirect] = text.match(canonicalRegex) ?? []
  return redirect ? fetch(`${new URL(redirect, url)}`) : res
}

function rebase(el: Element, attr: string, destination: string | URL) {
  const rebased = new URL(el.getAttribute(attr)!, destination)
  el.setAttribute(attr, rebased.pathname + rebased.hash)
}
function normalizeRelativeURLs(el: Document, destination: string | URL) {
  el.querySelectorAll('[href=""], [href^="./"], [href^="../"]').forEach((i) =>
    rebase(i, "href", destination),
  )
  el.querySelectorAll('[src=""], [src^="./"], [src^="../"]').forEach((i) =>
    rebase(i, "src", destination),
  )
}

function initPopovers(): () => void {
  const parser = new DOMParser()
  let activeAnchor: HTMLAnchorElement | null = null

  const clearActivePopover = () => {
    activeAnchor = null
    document.querySelectorAll(".popover").forEach((p) => p.classList.remove("active-popover"))
  }

  async function mouseEnterHandler(this: HTMLAnchorElement, ev: MouseEvent) {
    const link = (activeAnchor = this)
    if (link.dataset.noPopover === "true") return
    const { clientX, clientY } = ev

    const targetUrl = new URL(link.href)
    const hash = decodeURIComponent(targetUrl.hash)
    targetUrl.hash = ""
    targetUrl.search = ""
    const popoverId = `popover-${link.pathname}`

    const setPosition = async (popoverElement: HTMLElement) => {
      const { x, y } = await computePosition(link, popoverElement, {
        strategy: "fixed",
        middleware: [inline({ x: clientX, y: clientY }), shift(), flip()],
      })
      Object.assign(popoverElement.style, {
        transform: `translate(${x.toFixed()}px, ${y.toFixed()}px)`,
      })
    }

    const showPopover = (popoverElement: HTMLElement, popoverInner: HTMLElement) => {
      clearActivePopover()
      popoverElement.classList.add("active-popover")
      void setPosition(popoverElement)
      if (hash !== "") {
        const heading = popoverInner.querySelector(
          `#popover-internal-${hash.slice(1)}`,
        ) as HTMLElement | null
        if (heading) popoverInner.scroll({ top: heading.offsetTop - 12, behavior: "instant" })
      }
    }

    const prev = document.getElementById(popoverId)
    if (prev) {
      showPopover(prev, prev.querySelector(".popover-inner") as HTMLElement)
      return
    }

    const response = await fetchCanonical(targetUrl).catch((err) => console.error(err))
    if (!response) return
    const [contentType] = (response.headers.get("Content-Type") ?? "").split(";")
    const [category, typeInfo] = contentType.split("/")

    const popoverElement = document.createElement("div")
    popoverElement.id = popoverId
    popoverElement.classList.add("popover")
    const popoverInner = document.createElement("div")
    popoverInner.classList.add("popover-inner")
    popoverInner.dataset.contentType = contentType ?? undefined
    popoverElement.appendChild(popoverInner)

    if (category === "image") {
      const img = document.createElement("img")
      img.src = targetUrl.toString()
      img.alt = targetUrl.pathname
      popoverInner.appendChild(img)
    } else if (category === "application" && typeInfo === "pdf") {
      const pdf = document.createElement("iframe")
      pdf.src = targetUrl.toString()
      popoverInner.appendChild(pdf)
    } else {
      const contents = await response.text()
      const html = parser.parseFromString(contents, "text/html")
      normalizeRelativeURLs(html, targetUrl)
      html.querySelectorAll("[id]").forEach((el) => (el.id = `popover-internal-${el.id}`))
      const elts = [...html.getElementsByClassName("popover-hint")]
      if (elts.length === 0) return
      elts.forEach((elt) => popoverInner.appendChild(elt))
    }

    if (document.getElementById(popoverId)) return
    document.body.appendChild(popoverElement)
    if (activeAnchor !== link) return
    showPopover(popoverElement, popoverInner)
  }

  const links = [...document.querySelectorAll("a.internal")] as HTMLAnchorElement[]
  for (const link of links) {
    link.addEventListener("mouseenter", mouseEnterHandler)
    link.addEventListener("mouseleave", clearActivePopover)
  }

  return () => {
    for (const link of links) {
      link.removeEventListener("mouseenter", mouseEnterHandler)
      link.removeEventListener("mouseleave", clearActivePopover)
    }
  }
}

export default function Popover() {
  let teardown: (() => void) | null = null
  onMount(() => {
    teardown = initPopovers()
  })
  onCleanup(() => teardown?.())
  return null
}
