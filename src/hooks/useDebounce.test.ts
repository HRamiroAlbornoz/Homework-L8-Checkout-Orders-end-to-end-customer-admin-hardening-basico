import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce } from "./useDebounce";

describe("useDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna el valor inicial de inmediato", () => {
    const { result } = renderHook(() => useDebounce("a", 400));

    expect(result.current).toBe("a");
  });

  it("no actualiza el valor antes de que se cumpla el delay", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 400), {
      initialProps: { value: "a" },
    });

    rerender({ value: "ab" });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe("a");
  });

  it("actualiza el valor una vez que se cumple el delay completo", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 400), {
      initialProps: { value: "a" },
    });

    rerender({ value: "ab" });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(result.current).toBe("ab");
  });

  it("cancela el timeout anterior si el valor cambia antes de tiempo (tipeo rápido)", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 400), {
      initialProps: { value: "a" },
    });

    rerender({ value: "ab" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ value: "abc" });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Todavía no pasaron 400ms desde el último cambio ("abc"): "ab" nunca
    // llegó a confirmarse porque su timeout fue cancelado por el cleanup.
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Recién ahora se cumplieron los 400ms completos desde "abc" sin cambios.
    expect(result.current).toBe("abc");
  });

  it("limpia el timeout pendiente al desmontar, sin dejar timers colgados", () => {
    const { unmount } = renderHook(() => useDebounce("a", 400));

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
