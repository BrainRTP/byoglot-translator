import { expect, it } from "vitest";
import { sheetRect } from "../../../lib/selection/card";

it("pins the card to the bottom edge with 8px margins", () => {
  expect(sheetRect(320, 640, 200)).toEqual({ left: 8, top: 432, width: 304, height: 200 });
});

it("caps the height at 60 percent of the viewport", () => {
  expect(sheetRect(360, 800, 2000)).toEqual({ left: 8, top: 312, width: 344, height: 480 });
});
