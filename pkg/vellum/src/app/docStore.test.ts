import { describe, expect, test } from "bun:test";
import {
  emptyStore,
  addDoc,
  setActive,
  updateActiveSource,
  renameActive,
  deleteDoc,
  activeDoc,
  deriveTitle,
} from "./docStore.ts";

const opts = (n: number) => ({ id: `id-${n}`, now: n });

describe("deriveTitle", () => {
  test("uses the first directive label, else Untitled", () => {
    expect(deriveTitle(":::handout[Sealed Orders]\nx\n:::")).toBe(
      "Sealed Orders",
    );
    expect(deriveTitle("just prose")).toBe("Untitled");
  });
});

describe("docStore reducers", () => {
  test("add + setActive + activeDoc", () => {
    let store = emptyStore(":::item[A]\nx\n:::", opts(1));
    store = addDoc(store, ":::spell[B]\ny\n:::", opts(2));
    expect(store.docs).toHaveLength(2);
    expect(activeDoc(store).title).toBe("B"); // new doc is active
    store = setActive(store, "id-1");
    expect(activeDoc(store).title).toBe("A");
  });

  test("updateActiveSource re-derives title until pinned", () => {
    let store = emptyStore(":::item[A]\nx\n:::", opts(1));
    store = updateActiveSource(store, ":::item[Renamed]\nx\n:::", { now: 2 });
    expect(activeDoc(store).title).toBe("Renamed");
    store = renameActive(store, "My Title");
    store = updateActiveSource(store, ":::item[Ignored]\nx\n:::", { now: 3 });
    expect(activeDoc(store).title).toBe("My Title"); // pinned wins
  });

  test("deleteDoc keeps at least one and repoints active", () => {
    let store = emptyStore(":::item[A]\nx\n:::", opts(1));
    store = addDoc(store, ":::spell[B]\ny\n:::", opts(2)); // active id-2
    store = deleteDoc(store, "id-2");
    expect(store.docs).toHaveLength(1);
    expect(activeDoc(store).id).toBe("id-1");
    // deleting the last one resets to a single empty doc
    store = deleteDoc(store, "id-1");
    expect(store.docs).toHaveLength(1);
    expect(activeDoc(store).source).toBe("");
  });
});
