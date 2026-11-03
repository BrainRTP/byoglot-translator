import { describe, expect, it } from "vitest";
import { fromVisible, toVisible } from "../../quality/lib/code-visible.ts";

const slots = { "1": 'getResources("<someFileInsideTheJar>")', "2": "" };

describe("visible code placeholders", () => {
  it("round-trips code with markup characters and keeps empty slots as void tags", () => {
    const source = "Call <x1/> here<x2/> and <x3>link</x3>";
    const visible = toVisible(source, slots);
    expect(visible).toBe(
      'Call <c1>getResources("&lt;someFileInsideTheJar&gt;")</c1> here<x2/> and <x3>link</x3>',
    );
    expect(fromVisible(visible, slots)).toBe(source);
  });

  it("accepts code the model returned unescaped", () => {
    expect(fromVisible('Вызовите <c1>getResources("<someFileInsideTheJar>")</c1>', slots)).toBe(
      "Вызовите <x1/>",
    );
  });

  it("rejects changed code", () => {
    expect(fromVisible("<c1>Resourse</c1>", { "1": "Resource" })).toBeNull();
  });
});
