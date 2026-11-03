const ROOT_MARGIN = "200px";
const FIRST_CALLBACK_WAIT_MS = 100;

export type Visibility = {
  initial(elements: Element[]): Promise<Set<Element>>;
  watch(elements: Iterable<Element>): void;
  unwatch(elements: Iterable<Element>): void;
  disconnect(): void;
};

export function prioritize<T extends { element: Element }>(items: T[], visible: Set<Element>): T[] {
  return [
    ...items.filter((i) => visible.has(i.element)),
    ...items.filter((i) => !visible.has(i.element)),
  ];
}

export function createVisibility(opts: { onVisible(visible: Set<Element>): void }): Visibility {
  let io: IntersectionObserver | null = null;
  let firstVisible: ((visible: Set<Element>) => void) | null = null;

  const onIntersect = (entries: IntersectionObserverEntry[]) => {
    const visible = new Set<Element>();
    for (const entry of entries) if (entry.isIntersecting) visible.add(entry.target);
    if (firstVisible) {
      const resolve = firstVisible;
      firstVisible = null;
      resolve(visible);
    } else if (visible.size > 0) {
      opts.onVisible(visible);
    }
  };

  const observer = (): IntersectionObserver | null => {
    if (io) return io;
    const Ctor = globalThis.IntersectionObserver;
    if (!Ctor) return null;
    io = new Ctor(onIntersect, { rootMargin: ROOT_MARGIN });
    return io;
  };

  return {
    initial(elements) {
      const o = elements.length > 0 ? observer() : null;
      if (!o) return Promise.resolve(new Set());
      return new Promise((resolve) => {
        const done = (visible: Set<Element>) => {
          clearTimeout(wait);
          resolve(visible);
        };
        const wait = setTimeout(() => {
          if (firstVisible === done) firstVisible = null;
          resolve(new Set());
        }, FIRST_CALLBACK_WAIT_MS);
        firstVisible = done;
        for (const el of new Set(elements)) o.observe(el);
      });
    },
    watch(elements) {
      const o = observer();
      if (o) for (const el of elements) o.observe(el);
    },
    unwatch(elements) {
      if (io) for (const el of elements) io.unobserve(el);
    },
    disconnect() {
      io?.disconnect();
      io = null;
      firstVisible = null;
    },
  };
}
