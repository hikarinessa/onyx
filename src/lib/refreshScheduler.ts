/**
 * Collapses a burst of refresh requests into one call.
 *
 * `fire` runs `wait` ms after the most recent request, or `maxWait` ms after the first
 * request of a burst, whichever comes first. The trailing wait absorbs a burst (one file
 * tree refresh for a whole git checkout, not one per file); the ceiling keeps a sustained
 * storm refreshing periodically instead of starving until it ends.
 */
export interface RefreshScheduler {
  request(): void;
  cancel(): void;
}

export function createRefreshScheduler(
  fire: () => void,
  wait = 100,
  maxWait = 2000,
): RefreshScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let burstStart: number | null = null;

  const run = () => {
    timer = null;
    burstStart = null;
    fire();
  };

  return {
    request() {
      const now = Date.now();
      if (burstStart === null) burstStart = now;
      if (timer !== null) clearTimeout(timer);
      const untilCeiling = burstStart + maxWait - now;
      timer = setTimeout(run, Math.max(0, Math.min(wait, untilCeiling)));
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      burstStart = null;
    },
  };
}
