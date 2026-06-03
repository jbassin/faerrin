import { createFileRoute } from "@tanstack/react-router";
import EditorView from "@/components/Editor/EditorView";
import { FACTIONS } from "@/generated/factions";
import { CURRENT_REGIONS, CURRENT_SKEIN } from "@/generated/layers";

export const Route = createFileRoute("/editor")({
  component: EditorPage,
});

function EditorPage() {
  return (
    <main style={{ pointerEvents: "auto" }}>
      <EditorView
        factions={[...FACTIONS]}
        regions={[...CURRENT_REGIONS]}
        skein={CURRENT_SKEIN}
      />
    </main>
  );
}
