// Runs `task` now and every `everyMs` after, but only while the tab is visible.
// A hidden tab makes no requests; when it comes back, a missed cycle runs at
// once and a cycle that is not due yet waits out the rest of its interval.
export function startPoll(task: () => void, everyMs: number): () => void {
  let lastRun = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = () => {
    lastRun = Date.now();
    task();
    timer = setTimeout(run, everyMs);
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = undefined;
    if (document.hidden) return;
    const wait = lastRun + everyMs - Date.now();
    if (wait <= 0) run();
    else timer = setTimeout(run, wait);
  };

  document.addEventListener("visibilitychange", schedule);
  schedule();
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", schedule);
  };
}

export type PacerOptions = {
  // Wait after a success. Zero calls again on the next poll.
  everyMs: number;
  // Wait after the first failure in a row; each further failure doubles it.
  retryMs: number;
  maxMs: number;
};

export type Pacer = ReturnType<typeof pacer>;

// Paces calls to a feed with a tight rate limit or a habit of failing, so a
// feed that is refusing this tab hears from it less and less often.
export function pacer({ everyMs, retryMs, maxMs }: PacerOptions) {
  let nextAt = 0;
  let failures = 0;
  return {
    get nextAt() {
      return nextAt;
    },
    get failing() {
      return failures > 0;
    },
    due: (now = Date.now()) => now >= nextAt,
    // Not due yet only because the last call succeeded recently.
    resting: (now = Date.now()) => now < nextAt && failures === 0,
    succeeded(now = Date.now()) {
      failures = 0;
      nextAt = now + everyMs;
    },
    failed(now = Date.now()) {
      failures += 1;
      nextAt = now + Math.min(retryMs * 2 ** (failures - 1), maxMs);
    },
  };
}
