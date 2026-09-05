import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefreshScheduler } from "./refreshScheduler";

describe("createRefreshScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once, `wait` ms after a single request", () => {
    const fire = vi.fn();
    const s = createRefreshScheduler(fire, 100, 2000);
    s.request();
    vi.advanceTimersByTime(99);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst into one call after the last request", () => {
    const fire = vi.fn();
    const s = createRefreshScheduler(fire, 100, 2000);
    for (let i = 0; i < 10; i++) {
      s.request();
      vi.advanceTimersByTime(50);
    }
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("fires at the maxWait ceiling during a sustained storm", () => {
    const fire = vi.fn();
    const s = createRefreshScheduler(fire, 100, 2000);
    // A request every 50 ms for 5 s never lets the trailing wait expire.
    for (let elapsed = 0; elapsed < 5000; elapsed += 50) {
      s.request();
      vi.advanceTimersByTime(50);
    }
    // Ceiling at 2 s and 4 s; the 5 s trailing edge has not elapsed yet.
    expect(fire).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100);
    expect(fire).toHaveBeenCalledTimes(3);
  });

  it("starts a fresh burst after firing", () => {
    const fire = vi.fn();
    const s = createRefreshScheduler(fire, 100, 2000);
    s.request();
    vi.advanceTimersByTime(100);
    s.request();
    vi.advanceTimersByTime(100);
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it("cancel drops a pending call", () => {
    const fire = vi.fn();
    const s = createRefreshScheduler(fire, 100, 2000);
    s.request();
    s.cancel();
    vi.advanceTimersByTime(5000);
    expect(fire).not.toHaveBeenCalled();
  });
});
