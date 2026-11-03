import { describe, expect, it } from "vitest";
import type { AnimationKind } from "../../../lib/dom/effects/types";
import { nextLang, radioMove, tabbableKind } from "../../../lib/ui/animation-logic";

const KINDS: AnimationKind[] = ["none", "fade", "scramble", "flap"];

describe("radioMove", () => {
  it("moves forward with ArrowRight and ArrowDown", () => {
    expect(radioMove(KINDS, "fade", "ArrowRight")).toBe("scramble");
    expect(radioMove(KINDS, "fade", "ArrowDown")).toBe("scramble");
  });

  it("moves back with ArrowLeft and ArrowUp", () => {
    expect(radioMove(KINDS, "fade", "ArrowLeft")).toBe("none");
    expect(radioMove(KINDS, "fade", "ArrowUp")).toBe("none");
  });

  it("wraps around at both ends", () => {
    expect(radioMove(KINDS, "flap", "ArrowRight")).toBe("none");
    expect(radioMove(KINDS, "none", "ArrowLeft")).toBe("flap");
  });

  it("jumps with Home and End", () => {
    expect(radioMove(KINDS, "scramble", "Home")).toBe("none");
    expect(radioMove(KINDS, "scramble", "End")).toBe("flap");
  });

  it("ignores other keys", () => {
    expect(radioMove(KINDS, "fade", "Enter")).toBeNull();
    expect(radioMove(KINDS, "fade", "a")).toBeNull();
  });

  it("starts from the edge when the current kind is not in the list", () => {
    expect(radioMove(KINDS, "meteor", "ArrowRight")).toBe("none");
    expect(radioMove(KINDS, "meteor", "ArrowLeft")).toBe("flap");
  });

  it("returns null for an empty list", () => {
    expect(radioMove([], "fade", "ArrowRight")).toBeNull();
  });
});

describe("tabbableKind", () => {
  it("is the selected kind", () => {
    expect(tabbableKind(KINDS, "scramble")).toBe("scramble");
  });

  it("falls back to the first kind when nothing is selected", () => {
    expect(tabbableKind(KINDS, "meteor")).toBe("none");
  });
});

describe("nextLang", () => {
  it("flips between ru and en", () => {
    expect(nextLang("ru")).toBe("en");
    expect(nextLang("en")).toBe("ru");
  });
});
