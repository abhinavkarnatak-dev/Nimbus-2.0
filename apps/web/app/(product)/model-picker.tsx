"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Brain, ChevronDown, CircleDot } from "lucide-react";
import Link from "next/link";
import { useLaunchModelAvailability } from "./task-launch-form";
import type { SelectableCodexModel } from "@/lib/codex-models";
import {
  preferredCodexModel,
  preferredCodexEffort,
} from "@nimbus/codex/model-policy";

function defaultModel(models: SelectableCodexModel[]) {
  return preferredCodexModel(models);
}

export function ModelPicker({
  initialModels,
}: {
  initialModels: SelectableCodexModel[];
}) {
  const [models, setModels] = useState(initialModels);
  const [selection, setSelection] = useState({
    model: defaultModel(initialModels)?.id ?? "",
    effort: preferredCodexEffort(defaultModel(initialModels)),
  });
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const selected =
    models.find((model) => model.id === selection.model) ??
    defaultModel(models);
  const efforts = selected?.supportedReasoningEfforts ?? [];
  useLaunchModelAvailability(selected?.id);
  const effort =
    selected?.id === selection.model &&
    efforts.some((item) => item.reasoningEffort === selection.effort)
      ? selection.effort
      : preferredCodexEffort(selected);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    const controller = new AbortController();
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const response = await fetch("/api/codex/models", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Model refresh failed");
        const result = (await response.json()) as {
          models: SelectableCodexModel[];
        };
        if (!controller.signal.aborted) {
          setModels(result.models);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setError("Models could not refresh. Reconnect Codex or try again.");
      } finally {
        refreshing = false;
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 10000);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const effortIndex = Math.max(
    0,
    efforts.findIndex((item) => item.reasoningEffort === effort),
  );
  function chooseEffort(index: number) {
    setSelection({
      model: selected?.id ?? "",
      effort: efforts[index]?.reasoningEffort ?? "",
    });
  }
  return (
    <div className="model-picker" ref={container}>
      <input type="hidden" name="model" value={selected?.id ?? ""} />
      <input
        type="hidden"
        name="reasoningEffort"
        value={effort}
        disabled={!efforts.length}
      />
      <button
        ref={trigger}
        className="model-picker-trigger repo-picker"
        type="button"
        aria-label="Model and thinking effort"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <CircleDot size={15} aria-hidden="true" />
        <span>{selected?.label ?? "Connect Codex"}</span>
        {effort && <span className="model-effort-badge">{effort}</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div id={panelId} className="model-picker-panel" hidden={!open}>
        <label className="model-picker-heading" htmlFor={`${panelId}-model`}>
          Model
        </label>
        {models.length ? (
          <select
            id={`${panelId}-model`}
            aria-label="Codex model"
            value={selected?.id ?? ""}
            onChange={(event) => {
              const model = models.find(
                (item) => item.id === event.target.value,
              );
              setSelection({
                model: event.target.value,
                effort: preferredCodexEffort(model),
              });
            }}
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        ) : (
          <Link className="model-connect-link" href="/integrations">
            Connect Codex to load models
          </Link>
        )}
        <div className="model-effort-section">
          <div className="model-effort-heading">
            <label htmlFor={`${panelId}-effort`}>
              <Brain size={16} aria-hidden="true" /> Thinking effort
            </label>
            {effort && <output htmlFor={`${panelId}-effort`}>{effort}</output>}
          </div>
          {efforts.length ? (
            <>
              <input
                id={`${panelId}-effort`}
                type="range"
                aria-label="Thinking effort"
                min={0}
                max={Math.max(1, efforts.length - 1)}
                step={1}
                value={effortIndex}
                disabled={efforts.length < 2}
                aria-valuetext={effort}
                aria-describedby={`${panelId}-description`}
                onChange={(event) => chooseEffort(Number(event.target.value))}
              />
              <div className="model-effort-stops">
                {efforts.map((item, index) => (
                  <button
                    type="button"
                    key={item.reasoningEffort}
                    aria-pressed={effort === item.reasoningEffort}
                    onClick={() => chooseEffort(index)}
                  >
                    {item.reasoningEffort}
                  </button>
                ))}
              </div>
              <p id={`${panelId}-description`}>
                {efforts[effortIndex]?.description}
              </p>
            </>
          ) : (
            <p>
              {selected?.id === "fake-codex-test-provider"
                ? "Thinking effort is unavailable for the simulation provider."
                : "Codex has not returned effort options. Reconnect Codex to refresh its capabilities."}
            </p>
          )}
        </div>
        {error && <small role="status">{error}</small>}
      </div>
    </div>
  );
}
