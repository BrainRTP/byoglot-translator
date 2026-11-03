/** Runs tasks strictly in call order; only the reply of the latest call is applied. */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  let issued = 0;

  return {
    enqueue<T>(task: () => Promise<T>, apply: (result: T) => void): Promise<void> {
      const ticket = ++issued;
      const run = tail.then(task).then((result) => {
        if (ticket === issued) apply(result);
      });
      tail = run.catch(() => {});
      return run;
    },
  };
}
