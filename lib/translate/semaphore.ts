export function createSemaphore(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  const pump = () => {
    while (active < n && queue.length > 0) queue.shift()?.();
  };

  return {
    run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        const start = () => {
          signal?.removeEventListener("abort", onAbort);
          active++;
          (async () => fn())()
            .then(resolve, reject)
            .finally(() => {
              active--;
              pump();
            });
        };
        const onAbort = () => {
          const i = queue.indexOf(start);
          if (i >= 0) queue.splice(i, 1);
          reject(signal?.reason);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        queue.push(start);
        pump();
      });
    },
  };
}
