import type { CDPSession, Page } from "@playwright/test";

type CdpNode = {
  nodeId: number;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
  contentDocument?: CdpNode;
};

function findHost(node: CdpNode, mark: string): CdpNode | undefined {
  const attrs = node.attributes ?? [];
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrs[i] === "data-byoglot" && attrs[i + 1] === mark) return node;
  }
  for (const child of [
    ...(node.children ?? []),
    ...(node.shadowRoots ?? []),
    ...(node.contentDocument ? [node.contentDocument] : []),
  ]) {
    const hit = findHost(child, mark);
    if (hit) return hit;
  }
  return undefined;
}

export type ShadowHit = {
  text: string;
  center: { x: number; y: number };
  box: { x: number; y: number; width: number; height: number };
};

/** Closed shadow roots are invisible to Playwright locators, so the DOM is read over CDP. */
export async function queryClosedShadow(
  page: Page,
  innerSelector: string,
  mark = "selection",
): Promise<ShadowHit | null> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    const { root } = (await cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as {
      root: CdpNode;
    };
    const shadow = findHost(root, mark)?.shadowRoots?.[0];
    if (!shadow) return null;
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: shadow.nodeId,
      selector: innerSelector,
    });
    if (!nodeId) return null;
    const { object } = await cdp.send("DOM.resolveNode", { nodeId });
    const { result } = await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: "function () { return this.innerText; }",
      returnByValue: true,
    });
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId });
    const [x1, y1, x2, , , y3] = model.content;
    return {
      text: String(result.value ?? ""),
      center: { x: ((x1 ?? 0) + (x2 ?? 0)) / 2, y: ((y1 ?? 0) + (y3 ?? 0)) / 2 },
      box: { x: x1 ?? 0, y: y1 ?? 0, width: (x2 ?? 0) - (x1 ?? 0), height: (y3 ?? 0) - (y1 ?? 0) },
    };
  } finally {
    await cdp.detach();
  }
}

export async function countClosedShadow(
  page: Page,
  innerSelector: string,
  mark = "selection",
): Promise<number> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    const { root } = (await cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as {
      root: CdpNode;
    };
    const shadow = findHost(root, mark)?.shadowRoots?.[0];
    if (!shadow) return 0;
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
      nodeId: shadow.nodeId,
      selector: innerSelector,
    });
    return nodeIds.length;
  } finally {
    await cdp.detach();
  }
}
