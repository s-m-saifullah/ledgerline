import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppWide } from "./use-app-width";

let notify: () => void = () => {};
class FakeObserver {
  constructor(callback: () => void) {
    notify = callback;
  }
  observe() {}
  disconnect() {
    notify = () => {};
  }
}
const setWidth = (width: number) =>
  Object.defineProperty(document.body, "clientWidth", {
    configurable: true,
    value: width,
  });

describe("useAppWide", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setWidth(0);
  });

  it("starts from the body's width and follows it as it changes", () => {
    vi.stubGlobal("ResizeObserver", FakeObserver);
    setWidth(1200);
    const { result } = renderHook(() => useAppWide(1100));
    expect(result.current).toBe(true);
    setWidth(1099);
    act(() => notify());
    expect(result.current).toBe(false);
    setWidth(1100);
    act(() => notify());
    expect(result.current).toBe(true);
  });

  it("is false without a width and works where there is no observer", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    setWidth(0);
    const { result } = renderHook(() => useAppWide(1100));
    expect(result.current).toBe(false);
  });

  it("counts a page of exactly the minimum as wide, and one pixel less as not", () => {
    vi.stubGlobal("ResizeObserver", FakeObserver);
    setWidth(1100);
    expect(renderHook(() => useAppWide(1100)).result.current).toBe(true);
    cleanup();
    setWidth(1099);
    expect(renderHook(() => useAppWide(1100)).result.current).toBe(false);
  });
});
