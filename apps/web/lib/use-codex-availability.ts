"use client";

import { useEffect, useState } from "react";
import type { SelectableCodexModel } from "./codex-models";

// A stored task model is not evidence that its user's account is still connected.
export function useCodexAvailability() {
  return useCodexModels().length > 0;
}

export function useCodexModels() {
  const [models, setModels] = useState<SelectableCodexModel[]>([]);
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
          setModels(Array.isArray(result?.models) ? result.models : []);
      } catch {
        if (!controller.signal.aborted) setModels([]);
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
  return models;
}
