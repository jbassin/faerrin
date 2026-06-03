import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TimelineStrip from "./TimelineStrip";
import { stepDwellMs, imperialDate } from "@/lib/timeline";
import type { Layer } from "@/lib/regions";

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    slug: "one",
    timestamp: "863-07-13T14:21:00Z",
    message: "Hildebrandt arrives on the strider",
    changes: [],
    body: "",
    ...overrides,
  };
}

describe("stepDwellMs", () => {
  it("returns the base dwell at step 0", () => {
    expect(stepDwellMs(0)).toBe(900);
  });

  it("decreases monotonically as steps grow", () => {
    expect(stepDwellMs(1)).toBeLessThan(stepDwellMs(0));
    expect(stepDwellMs(2)).toBeLessThan(stepDwellMs(1));
    expect(stepDwellMs(5)).toBeLessThan(stepDwellMs(4));
  });

  it("floors at the minimum dwell once decay would drop below it", () => {
    expect(stepDwellMs(20)).toBe(220);
    expect(stepDwellMs(100)).toBe(220);
  });

  it("clamps negative steps up to step 0", () => {
    expect(stepDwellMs(-1)).toBe(stepDwellMs(0));
  });
});

describe("TimelineStrip", () => {
  const twoLayers = [
    makeLayer(),
    makeLayer({
      slug: "two",
      timestamp: "863-07-14T09:00:00Z",
      message: "Iconoclasm builds their fane.",
    }),
  ];

  it("renders only the VOX-INACTIVE entry at index 0", () => {
    render(
      <TimelineStrip
        layers={twoLayers}
        index={0}
        isPlaying={false}
        dwellMs={500}
        onIndexChange={() => {}}
      />,
    );
    expect(screen.queryByText("++ VOX-INACTIVE ++")).not.toBeNull();
    expect(screen.queryByText("Hildebrandt arrives on the strider")).toBeNull();
    expect(screen.queryByText("Iconoclasm builds their fane.")).toBeNull();
  });

  it("stacks both layer messages plus VOX-INACTIVE at the full index, newest first", () => {
    render(
      <TimelineStrip
        layers={twoLayers}
        index={2}
        isPlaying={false}
        dwellMs={500}
        onIndexChange={() => {}}
      />,
    );
    expect(screen.queryByText("Iconoclasm builds their fane.")).not.toBeNull();
    expect(
      screen.queryByText("Hildebrandt arrives on the strider"),
    ).not.toBeNull();
    expect(screen.queryByText("++ VOX-INACTIVE ++")).not.toBeNull();
  });

  it("formats layer timestamps in Imperial M.YYY.DDD +HHMMhrs form", () => {
    render(
      <TimelineStrip
        layers={twoLayers}
        index={2}
        isPlaying={false}
        dwellMs={500}
        onIndexChange={() => {}}
      />,
    );
    expect(screen.queryByText("M.863.194 +1421hrs")).not.toBeNull();
    expect(screen.queryByText("M.863.195 +0900hrs")).not.toBeNull();
  });

  it("renders position count in the footer", () => {
    render(
      <TimelineStrip
        layers={twoLayers}
        index={1}
        isPlaying={false}
        dwellMs={500}
        onIndexChange={() => {}}
      />,
    );
    expect(screen.queryByText("1/2")).not.toBeNull();
  });

  it("caps visible entries at VISIBLE_SLOTS (5) when history exceeds it", () => {
    const many: Layer[] = Array.from({ length: 8 }, (_, i) =>
      makeLayer({
        slug: `l${i}`,
        timestamp: `863-07-13T${String(10 + i).padStart(2, "0")}:00:00Z`,
        message: `event-${i}`,
      }),
    );
    render(
      <TimelineStrip
        layers={many}
        index={8}
        isPlaying={false}
        dwellMs={500}
        onIndexChange={() => {}}
      />,
    );
    // 8 layers, index 8 (latest applied) — newest 5 events visible, older unmounted.
    expect(screen.queryByText("event-7")).not.toBeNull();
    expect(screen.queryByText("event-6")).not.toBeNull();
    expect(screen.queryByText("event-5")).not.toBeNull();
    expect(screen.queryByText("event-4")).not.toBeNull();
    expect(screen.queryByText("event-3")).not.toBeNull();
    expect(screen.queryByText("event-2")).toBeNull();
    expect(screen.queryByText("event-1")).toBeNull();
    expect(screen.queryByText("event-0")).toBeNull();
    expect(screen.queryByText("++ VOX-INACTIVE ++")).toBeNull();
  });

  describe("imperialDate", () => {
    it("transforms ISO timestamp to Imperial form with day-of-year and 24h time", () => {
      expect(imperialDate("863-07-13T14:21:00Z")).toBe("M.863.194 +1421hrs");
      expect(imperialDate("863-01-01T00:00:00Z")).toBe("M.863.001 +0000hrs");
      expect(imperialDate("863-12-31T23:59:00Z")).toBe("M.863.365 +2359hrs");
    });
  });

  it("disables both arrows while playing", () => {
    render(
      <TimelineStrip
        layers={twoLayers}
        index={1}
        isPlaying={true}
        dwellMs={500}
        onIndexChange={() => {}}
      />,
    );
    expect(
      (screen.getByLabelText("Previous layer") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Next layer") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables prev at index 0 and next at index === layers.length", () => {
    const { rerender } = render(
      <TimelineStrip
        layers={twoLayers}
        index={0}
        isPlaying={false}
        dwellMs={500}
        onIndexChange={() => {}}
      />,
    );
    expect(
      (screen.getByLabelText("Previous layer") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Next layer") as HTMLButtonElement).disabled,
    ).toBe(false);

    rerender(
      <TimelineStrip
        layers={twoLayers}
        index={2}
        isPlaying={false}
        dwellMs={500}
        onIndexChange={() => {}}
      />,
    );
    expect(
      (screen.getByLabelText("Previous layer") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByLabelText("Next layer") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("calls onIndexChange with neighboring index on arrow click", () => {
    const onChange = vi.fn();
    render(
      <TimelineStrip
        layers={twoLayers}
        index={1}
        isPlaying={false}
        dwellMs={500}
        onIndexChange={onChange}
      />,
    );
    screen.getByLabelText("Previous layer").click();
    screen.getByLabelText("Next layer").click();
    expect(onChange).toHaveBeenNthCalledWith(1, 0);
    expect(onChange).toHaveBeenNthCalledWith(2, 2);
  });
});
