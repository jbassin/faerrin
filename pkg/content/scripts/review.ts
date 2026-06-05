import http from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import { dataDir } from "./lib/paths"
import { addCorrection } from "./lib/defs"
import { review } from "./config"
import { log } from "./lib/log"

async function getSessions(): Promise<string[]> {
  const files = await fs.readdir(dataDir)
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
}

async function getSession(date: string): Promise<unknown | null> {
  const filePath = path.join(dataDir, `${date}.json`)
  try {
    const raw = await fs.readFile(filePath, "utf8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

function readBody(
  req: IncomingMessage,
): Promise<{ correction?: string; misTranscription?: string } | null> {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (chunk) => {
      data += chunk
    })
    req.on("end", () => {
      try {
        resolve(JSON.parse(data))
      } catch {
        resolve(null)
      }
    })
    req.on("error", reject)
  })
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Transcript Review</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #1a1a1f;
    --bg-sidebar: #111115;
    --bg-hover: #2a2a32;
    --bg-active: #2e2e3e;
    --border: #2e2e3e;
    --text: #d4d4dc;
    --text-dim: #666;
    --text-ts: #555;
    --accent: #7c6ef7;
    --accent-hover: #9287f9;
    --pill-bg: #7c6ef7;
    --pill-text: #fff;
    --modal-bg: #1e1e26;
    --modal-border: #3a3a4a;
    --input-bg: #111115;
    --toast-bg: #2e4a2e;
    --toast-text: #a0d4a0;

    --textJosh: rgb(255, 198, 255);
    --textJorge: rgb(155, 246, 255);
    --textMike: rgb(255, 173, 173);
    --textNoah: rgb(202, 255, 191);
    --textTanner: rgb(255, 214, 165);
    --textGuest: rgb(235, 235, 236);
  }

  html, body { height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); font-size: 14px; }

  #app { display: flex; height: 100vh; overflow: hidden; }

  #sidebar {
    width: 240px;
    flex-shrink: 0;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  #sidebar-header {
    padding: 16px 14px 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  #session-list { overflow-y: auto; flex: 1; padding: 6px 0; }
  .session-item {
    padding: 8px 14px;
    cursor: pointer;
    color: var(--text);
    font-size: 13px;
    border-radius: 4px;
    margin: 0 4px;
    transition: background 0.1s;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .session-item:hover { background: var(--bg-hover); }
  .session-item.active { background: var(--bg-active); color: var(--accent); }

  #transcript {
    flex: 1;
    overflow-y: auto;
    padding: 32px 48px;
  }
  #transcript-placeholder {
    color: var(--text-dim);
    margin-top: 120px;
    text-align: center;
    font-size: 15px;
  }
  #transcript-header {
    margin-bottom: 28px;
  }
  #transcript-header h1 {
    font-size: 20px;
    font-weight: 600;
    color: var(--text);
  }
  #transcript-header p {
    color: var(--text-dim);
    font-size: 12px;
    margin-top: 4px;
  }

  .line {
    display: grid;
    grid-template-columns: 68px 90px 1fr;
    gap: 0 10px;
    padding: 3px 0;
    line-height: 1.6;
  }
  .line:hover { background: rgba(255,255,255,0.02); border-radius: 3px; }
  .ts { color: var(--text-ts); font-size: 11px; font-variant-numeric: tabular-nums; padding-top: 2px; }
  .speaker { font-weight: 600; font-size: 12px; text-align: right; padding-top: 2px; }
  .text { color: var(--text); user-select: text; }

  #correct-btn {
    position: fixed;
    display: none;
    padding: 5px 12px;
    background: var(--pill-bg);
    color: var(--pill-text);
    border: none;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.5);
    z-index: 100;
    white-space: nowrap;
    transition: background 0.1s;
  }
  #correct-btn:hover { background: var(--accent-hover); }

  #modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }
  #modal-overlay.visible { display: flex; }
  #modal {
    background: var(--modal-bg);
    border: 1px solid var(--modal-border);
    border-radius: 8px;
    padding: 24px 28px;
    width: 420px;
    max-width: 90vw;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  }
  #modal h2 { font-size: 15px; font-weight: 600; margin-bottom: 18px; }
  .modal-field { margin-bottom: 14px; }
  .modal-field label { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); margin-bottom: 6px; }
  .modal-field .selected-text {
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--modal-border);
    border-radius: 4px;
    padding: 7px 10px;
    font-style: italic;
    color: var(--text);
    font-size: 13px;
    word-break: break-word;
  }
  .modal-field input {
    width: 100%;
    background: var(--input-bg);
    border: 1px solid var(--modal-border);
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--text);
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
  }
  .modal-field input:focus { border-color: var(--accent); }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
  .btn { padding: 7px 16px; border-radius: 5px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: background 0.1s; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-secondary { background: rgba(255,255,255,0.08); color: var(--text); }
  .btn-secondary:hover { background: rgba(255,255,255,0.13); }

  #toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: var(--toast-bg);
    color: var(--toast-text);
    border-radius: 6px;
    padding: 10px 18px;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 2px 12px rgba(0,0,0,0.5);
    z-index: 300;
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.2s, transform 0.2s;
    pointer-events: none;
  }
  #toast.visible { opacity: 1; transform: translateY(0); }
</style>
</head>
<body>

<div id="app">
  <aside id="sidebar">
    <div id="sidebar-header">Sessions</div>
    <div id="session-list"><div style="padding:12px 14px;color:var(--text-dim)">Loading…</div></div>
  </aside>
  <main id="transcript">
    <div id="transcript-placeholder">Select a session to begin</div>
    <div id="transcript-inner" style="display:none">
      <div id="transcript-header"></div>
      <div id="transcript-content"></div>
    </div>
  </main>
</div>

<button id="correct-btn">Correct this</button>

<div id="modal-overlay">
  <div id="modal">
    <h2>Add correction</h2>
    <div class="modal-field">
      <label>Selected text</label>
      <div class="selected-text" id="modal-selected"></div>
    </div>
    <div class="modal-field">
      <label>Correct to</label>
      <input id="modal-input" type="text" placeholder="Enter the correct form…">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Save</button>
    </div>
  </div>
</div>

<div id="toast">Saved to defs.yaml</div>

<script>
const sessionList = document.getElementById('session-list')
const transcriptPlaceholder = document.getElementById('transcript-placeholder')
const transcriptInner = document.getElementById('transcript-inner')
const transcriptHeader = document.getElementById('transcript-header')
const transcriptContent = document.getElementById('transcript-content')
const correctBtn = document.getElementById('correct-btn')
const modalOverlay = document.getElementById('modal-overlay')
const modalSelected = document.getElementById('modal-selected')
const modalInput = document.getElementById('modal-input')
const modalSave = document.getElementById('modal-save')
const modalCancel = document.getElementById('modal-cancel')
const toast = document.getElementById('toast')

let pendingSelection = null
let toastTimer = null

function formatDate(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

async function loadSessions() {
  const res = await fetch('/api/sessions')
  const dates = await res.json()
  sessionList.innerHTML = ''
  for (const date of dates) {
    const el = document.createElement('div')
    el.className = 'session-item'
    el.textContent = formatDate(date)
    el.dataset.date = date
    el.addEventListener('click', () => loadSession(date, el))
    sessionList.appendChild(el)
  }
}

async function loadSession(date, el) {
  document.querySelectorAll('.session-item').forEach(s => s.classList.remove('active'))
  el.classList.add('active')

  transcriptPlaceholder.style.display = 'none'
  transcriptInner.style.display = 'block'
  transcriptContent.innerHTML = '<div style="color:var(--text-dim);padding:20px 0">Loading…</div>'

  const res = await fetch('/api/session/' + date)
  if (!res.ok) {
    transcriptContent.innerHTML = '<div style="color:var(--text-dim)">Failed to load session.</div>'
    return
  }
  const data = await res.json()

  transcriptHeader.innerHTML =
    '<h1>' + formatDate(data.date) + '</h1>' +
    '<p>' + data.script.length + ' lines</p>'

  transcriptContent.innerHTML = ''
  for (const line of data.script) {
    const div = document.createElement('div')
    div.className = 'line'

    const ts = document.createElement('span')
    ts.className = 'ts'
    ts.textContent = line.start

    const speaker = document.createElement('span')
    speaker.className = 'speaker'
    speaker.textContent = line.user.name
    speaker.style.color = 'var(' + line.user.color + ')'

    const text = document.createElement('span')
    text.className = 'text'
    text.textContent = line.text

    div.appendChild(ts)
    div.appendChild(speaker)
    div.appendChild(text)
    transcriptContent.appendChild(div)
  }
}

function hideCorrectBtn() {
  correctBtn.style.display = 'none'
  pendingSelection = null
}

function showCorrectBtn(rect, selected) {
  pendingSelection = selected
  correctBtn.style.display = 'block'
  correctBtn.style.left = (rect.left + rect.width / 2 - correctBtn.offsetWidth / 2) + 'px'
  correctBtn.style.top = (rect.bottom + window.scrollY + 8) + 'px'
}

document.addEventListener('mouseup', (e) => {
  if (correctBtn.contains(e.target)) return
  if (modalOverlay.contains(e.target)) return

  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) { hideCorrectBtn(); return }

  const selected = sel.toString().trim()
  if (!selected) { hideCorrectBtn(); return }

  const anchor = sel.anchorNode
  if (!transcriptContent.contains(anchor)) { hideCorrectBtn(); return }

  const range = sel.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  showCorrectBtn(rect, selected)
})

document.addEventListener('mousedown', (e) => {
  if (!correctBtn.contains(e.target) && !modalOverlay.contains(e.target)) {
    hideCorrectBtn()
  }
})

function openModal(selected) {
  modalSelected.textContent = selected
  modalInput.value = ''
  modalOverlay.classList.add('visible')
  setTimeout(() => modalInput.focus(), 50)
}

function closeModal() {
  modalOverlay.classList.remove('visible')
  modalInput.value = ''
}

correctBtn.addEventListener('click', () => {
  if (!pendingSelection) return
  openModal(pendingSelection)
  hideCorrectBtn()
})

modalCancel.addEventListener('click', closeModal)
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal()
})

modalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') modalSave.click()
  if (e.key === 'Escape') closeModal()
})

modalSave.addEventListener('click', async () => {
  const correction = modalInput.value.trim()
  const misTranscription = modalSelected.textContent.trim()
  if (!correction || !misTranscription) return

  modalSave.disabled = true
  try {
    const res = await fetch('/api/correction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correction, misTranscription })
    })
    if (res.ok) {
      closeModal()
      showToast()
    } else {
      alert('Failed to save correction.')
    }
  } finally {
    modalSave.disabled = false
  }
})

function showToast() {
  clearTimeout(toastTimer)
  toast.classList.add('visible')
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2000)
}

loadSessions()
</script>
</body>
</html>`

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://localhost:${review.port}`)
  const pathname = url.pathname

  try {
    if (req.method === "GET" && pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(HTML)
    } else if (req.method === "GET" && pathname === "/api/sessions") {
      json(res, 200, await getSessions())
    } else if (req.method === "GET" && pathname.startsWith("/api/session/")) {
      const date = pathname.slice("/api/session/".length)
      const session = await getSession(date)
      if (!session) {
        json(res, 404, { error: "not found" })
        return
      }
      json(res, 200, session)
    } else if (req.method === "POST" && pathname === "/api/correction") {
      const body = await readBody(req)
      if (!body || !body.correction || !body.misTranscription) {
        json(res, 400, { error: "missing fields" })
        return
      }
      await addCorrection(body.correction, body.misTranscription)
      json(res, 200, { ok: true })
    } else {
      json(res, 404, { error: "not found" })
    }
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err))
    json(res, 500, { error: "internal error" })
  }
})

server.listen(review.port, () => {
  log.info(`Transcript review running at http://localhost:${review.port}`)
})
