const LIST_ITEM = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*)/;

function appendInline(parent: Node, text: string, doc: Document): void {
  text.split(INLINE).forEach((part, i) => {
    if (!part) return;
    // split with a capture group puts the matched inline spans at odd indexes
    if (i % 2 === 0) {
      parent.appendChild(doc.createTextNode(part));
      return;
    }
    const bold = part.startsWith("**");
    const el = doc.createElement(part.startsWith("`") ? "code" : bold ? "strong" : "em");
    el.textContent = part.slice(bold ? 2 : 1, bold ? -2 : -1);
    parent.appendChild(el);
  });
}

export function renderSafeMarkdown(text: string, doc: Document): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  let paragraph: HTMLElement | null = null;
  let list = null as HTMLElement | null;

  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) {
      paragraph = null;
      list = null;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const tag = item[1] ? "ul" : "ol";
      if (list?.localName !== tag) {
        list = doc.createElement(tag);
        fragment.appendChild(list);
      }
      const li = doc.createElement("li");
      appendInline(li, item[3] ?? "", doc);
      list.appendChild(li);
      paragraph = null;
      continue;
    }
    list = null;
    const heading = HEADING.exec(line);
    if (heading) {
      const p = doc.createElement("p");
      p.className = "h";
      appendInline(p, heading[1] ?? "", doc);
      fragment.appendChild(p);
      paragraph = null;
      continue;
    }
    if (paragraph) paragraph.appendChild(doc.createElement("br"));
    else {
      paragraph = doc.createElement("p");
      fragment.appendChild(paragraph);
    }
    appendInline(paragraph, line.trim(), doc);
  }
  return fragment;
}
