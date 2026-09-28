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
