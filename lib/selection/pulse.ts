const PERIOD_MS = 1200;
let counter = 0;

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(value: string): Rgba {
  const m = value.match(
    /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/,
  );
  if (!m) return { r: 0, g: 0, b: 0, a: 1 };
  const alpha =
    m[4] === undefined ? 1 : m[4].endsWith("%") ? Number.parseFloat(m[4]) / 100 : Number(m[4]);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: alpha };
}

export function pulseText(doc: Document, nodes: Text[]): () => void {
  const registry = doc.defaultView?.CSS?.highlights ?? globalThis.CSS?.highlights;
  const Highlight = (globalThis as { Highlight?: new (...r: Range[]) => Highlight }).Highlight;
  if (!registry || !Highlight || nodes.length === 0) return () => {};

  const win = doc.defaultView ?? window;
  const groups = new Map<string, { color: Rgba; ranges: Range[] }>();
  for (const node of nodes) {
    const el = node.parentElement;
    if (!el) continue;
    const css = win.getComputedStyle(el).color;
    const group = groups.get(css) ?? { color: parseColor(css), ranges: [] };
    const range = doc.createRange();
    range.selectNodeContents(node);
    group.ranges.push(range);
    groups.set(css, group);
  }

  const names: string[] = [];
  const style = doc.createElement("style");
  style.setAttribute("data-byoglot", "pulse");
  const entries = [...groups.values()].map((g) => {
    const name = `byoglot-pulse-${counter++}`;
    names.push(name);
    registry.set(name, new Highlight(...g.ranges));
    return { name, color: g.color };
  });
  const paint = (factor: number) => {
    style.textContent = entries
      .map(
        ({ name, color: c }) =>
          `::highlight(${name}){color:rgb(${c.r} ${c.g} ${c.b} / ${+(c.a * factor).toFixed(3)})}`,
      )
      .join("");
  };
  (doc.head ?? doc.documentElement).append(style);

  let frame = 0;
  let stopped = false;
  if (win.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    paint(0.6);
  } else {
    const start = performance.now();
    const tick = (now: number) => {
      paint(0.7 + 0.3 * Math.cos((2 * Math.PI * (now - start)) / PERIOD_MS));
      frame = win.requestAnimationFrame(tick);
    };
    paint(1);
    frame = win.requestAnimationFrame(tick);
  }

  return () => {
    if (stopped) return;
    stopped = true;
    win.cancelAnimationFrame?.(frame);
    for (const name of names) registry.delete(name);
    style.remove();
  };
}
