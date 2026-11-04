import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setUiLang } from "../../../lib/i18n";
import { describeError } from "../../../lib/ui/errors";

beforeEach(() => setUiLang("en"));
afterEach(() => setUiLang("auto"));

describe("describeError for the popup", () => {
  it("offline shows the service start hint and retry", () => {
    const v = describeError("offline", "popup");
    expect(v).toMatchObject({
      tone: "er",
      title: "opencode is not running",
      hint: "opencode service start",
      action: "retry",
    });
    expect(v.body).toContain("Retry");
  });

  it("rate_limit is a warning with time, clock and a choose-model action", () => {
    const v = describeError("rate_limit", "popup", 84 * 60_000, Date.UTC(2026, 10, 3, 6, 46));
    expect(v.tone).toBe("wn");
    expect(v.action).toBe("chooseModel");
    expect(v.body).toMatch(/Resets in 1 h 24 min \(at \d{2}:\d{2}\)/);
  });

  it("rate_limit without a delay has no time", () => {
    expect(describeError("rate_limit", "popup").body).toBe(
      "Translation is paused. Try again later or choose another model.",
    );
  });

  it("provider_auth shows the login hint and retry", () => {
    expect(describeError("provider_auth", "popup")).toMatchObject({
      hint: "opencode auth login",
      action: "retry",
    });
  });

  it("unauthorized sends the user to onboarding", () => {
    expect(describeError("unauthorized", "popup").action).toBe("connect");
  });

  it("incompatible and provider errors are retryable", () => {
    expect(describeError("incompatible", "popup").action).toBe("retry");
    expect(describeError("provider_error", "popup").action).toBe("retry");
    expect(describeError("bad_response", "popup").action).toBe("retry");
  });

  it("no_model asks to choose a model", () => {
    expect(describeError("no_model", "popup")).toMatchObject({
      title: "No model chosen",
      body: "Choose a model in settings.",
      action: "chooseModel",
    });
  });
});

describe("describeError for the card", () => {
  it("rate_limit joins the delay and the 24h reset clock", () => {
    const now = new Date(2026, 10, 3, 6, 46).getTime();
    const v = describeError("rate_limit", "card", 5_040_000, now);
    expect(v.body).toBe(
      "Resets in 1 h 24 min (at 08:10). You can choose another model in settings.",
    );
  });

  it("rate_limit without a delay has no time", () => {
    expect(describeError("rate_limit", "card").body).toBe(
      "Try again later. You can choose another model in settings.",
    );
  });

  it("uses the card wording with the same hints", () => {
    expect(describeError("offline", "card")).toMatchObject({
      body: "Start the server in a terminal and retry.",
      hint: "opencode service start",
    });
  });

  it("formats the reset clock in 24h in the interface language", () => {
    setUiLang("ru");
    const now = new Date(2026, 10, 3, 13, 5).getTime();
    expect(describeError("rate_limit", "card", 3_600_000, now).body).toContain("в 14:05");
  });
});

describe("describeError for a provider connection", () => {
  const now = Date.UTC(2026, 10, 3, 6, 46);

  it.each(["offline", "incompatible", "provider_auth"] as const)(
    "%s never mentions opencode and has no hint",
    (kind) => {
      for (const surface of ["popup", "card"] as const) {
        const v = describeError(kind, surface, undefined, now, "provider");
        expect(`${v.title} ${v.body}`).not.toMatch(/opencode/i);
        expect(v.hint).toBeUndefined();
      }
    },
  );

  it("offline names the provider", () => {
    expect(describeError("offline", "card", undefined, now, "provider").title).toBe(
      "Cannot reach the provider",
    );
  });

  it("opencode texts stay the default", () => {
    expect(describeError("offline", "card", undefined, now).title).toBe("opencode is not running");
  });
});
