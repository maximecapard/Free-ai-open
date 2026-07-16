import { afterEach, describe, expect, it, vi } from "vitest";
import { STREAM_RENDER_INTERVAL_MS, createStreamingTextBuffer } from "./streamingBuffer";

describe("streaming text buffer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("combines small chunks without losing characters", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = createStreamingTextBuffer({ onFlush });

    buffer.append("Hel");
    buffer.append("lo");

    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(STREAM_RENDER_INTERVAL_MS);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith("Hello");
  });

  it("respects the render interval before flushing", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = createStreamingTextBuffer({ onFlush });

    buffer.append("A");
    vi.advanceTimersByTime(STREAM_RENDER_INTERVAL_MS - 1);
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledWith("A");
  });

  it("flushes pending text on completion", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = createStreamingTextBuffer({ onFlush });

    buffer.append("final");
    buffer.flush();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith("final");

    vi.advanceTimersByTime(STREAM_RENDER_INTERVAL_MS);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("flushes pending text on cancellation or error disposal by default", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = createStreamingTextBuffer({ onFlush });

    buffer.append("partial");
    buffer.dispose();

    expect(onFlush).toHaveBeenCalledWith("partial");
  });

  it("can discard pending text without logging generated content", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const sensitiveGeneratedText = "PRIVATE GENERATED RESPONSE";
    const buffer = createStreamingTextBuffer({ onFlush });

    buffer.append(sensitiveGeneratedText);
    buffer.dispose({ flushPending: false });

    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(STREAM_RENDER_INTERVAL_MS);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("is independent from unrelated locale and theme state", () => {
    vi.useFakeTimers();
    let locale = "fr";
    let theme = "dark";
    const onFlush = vi.fn();
    const buffer = createStreamingTextBuffer({ onFlush });

    buffer.append("Bon");
    locale = "en";
    theme = "light";
    buffer.append("jour");
    buffer.flush();

    expect(onFlush).toHaveBeenCalledWith("Bonjour");
    expect(locale).toBe("en");
    expect(theme).toBe("light");
  });
});
