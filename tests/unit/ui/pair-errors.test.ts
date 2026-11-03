import { describe, expect, it } from "vitest";
import { pairErrorView } from "../../../lib/ui/pair-errors";

describe("pairErrorView", () => {
  it("unauthorized by link means the link expired", () => {
    expect(pairErrorView("unauthorized", "link").kind).toBe("expired");
  });

  it("unauthorized in manual mode means wrong credentials", () => {
    expect(pairErrorView("unauthorized", "manual").kind).toBe("badPassword");
  });

  it("offline means the server is unreachable in both modes", () => {
    expect(pairErrorView("offline", "link").kind).toBe("unreachable");
    expect(pairErrorView("offline", "manual").kind).toBe("unreachable");
  });

  it("incompatible keeps its own message", () => {
    expect(pairErrorView("incompatible", "link").kind).toBe("incompatible");
  });

  it("anything else is an unrecognized link", () => {
    expect(pairErrorView("bad_response", "link").kind).toBe("badLink");
    expect(pairErrorView("provider_error", "manual").kind).toBe("badLink");
  });
});
