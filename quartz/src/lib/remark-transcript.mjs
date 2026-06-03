// Ported verbatim (logic) from quartz/plugins/transformers/transcript.ts.
// Expands the pipeline's `::transcript-audio{...}` / `:::transcript-line{...}`
// directives into the audio player + per-line markup. Relies on remark-directive
// (registered separately, ahead of this) to have parsed the directive nodes.
// Interactive click-to-seek is a Phase 3 island; here we emit only structure.
import { visit } from "unist-util-visit"

export default function remarkTranscript() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type === "leafDirective" && node.name === "transcript-audio") {
        const { date, audio } = node.attributes ?? {}
        node.data = node.data ?? {}
        node.data.hName = "audio"
        node.data.hProperties = {
          id: `audio-${date}`,
          "data-transcript": date,
          preload: "auto",
          tabindex: "0",
          controls: true,
          type: "audio/mpeg",
        }
        node.children = [
          {
            type: "paragraph",
            data: { hName: "source", hProperties: { type: "audio/mp3", src: audio } },
            children: [],
          },
          { type: "text", value: "Sorry, your browser does not support HTML5 audio." },
        ]
        return
      }

      if (node.type === "containerDirective" && node.name === "transcript-line") {
        const { second, user, start } = node.attributes ?? {}
        // `char` is the campaign character name; falls back to the real speaker
        // for sessions that matched no campaign. The label shows `char` by
        // default (the toggle defaults to character names); both names ride
        // along as data-* so TranscriptPlayer can swap the text client-side.
        const char = node.attributes?.char || user
        node.data = node.data ?? {}
        node.data.hName = "div"
        node.data.hProperties = {
          id: `${second}-${user}`,
          // Color/filter classes stay keyed on the real speaker so they survive
          // the name toggle.
          className: ["transcript-line", user],
          "data-second": second,
          "data-user": user,
          "data-char": char,
        }
        for (const child of node.children) {
          if (child.type === "paragraph") {
            child.data = child.data ?? {}
            child.data.hName = "span"
            child.data.hProperties = { className: "transcript-content" }
          }
        }
        const timeButton = {
          type: "paragraph",
          data: {
            hName: "button",
            hProperties: {
              className: "transcript-time",
              type: "button",
              "aria-label": `Seek to ${start}`,
            },
          },
          children: [{ type: "text", value: start }],
        }
        const nameSpan = {
          type: "paragraph",
          data: {
            hName: "span",
            hProperties: {
              className: ["transcript-name", user],
              "data-real": user,
              "data-char": char,
            },
          },
          children: [{ type: "text", value: `${char}:` }],
        }
        node.children = [timeButton, nameSpan, ...node.children]
      }
    })
  }
}
