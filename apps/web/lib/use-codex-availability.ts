"use client";

import { useEffect, useState } from "react";

// A stored task model is not evidence that its user's account is still connected.
export function useCodexAvailability() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch("/api/codex/models", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15_000),
          ]),
        });
        const result = response.ok ? await response.json() : null;
        if (!controller.signal.aborted)
          setAvailable(
            Array.isArray(result?.models) && result.models.length > 0,
          );
      } catch {
        if (!controller.signal.aborted) setAvailable(false);
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return available;
}
