"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Brain, ChevronDown, CircleDot } from "lucide-react";
import type { SelectableCodexModel } from "@/lib/codex-models";
import { preferredCodexEffort } from "@nimbus/codex/model-policy";
import styles from "./conversation.module.css";

// Uses the dashboard's picker styles, but leaves settings and catalog ownership
// with the existing chat composer. Opening this panel never changes a setting.
export function FollowupModelPicker({
  models,
  model,
  effort,
  disabled,
  onModelChange,
  onEffortChange,
}: {
  models: SelectableCodexModel[];
  model: string;
  effort: string | null;
  disabled: boolean;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const selected = models.find((item) => item.id === model);
  const efforts = selected?.supportedReasoningEfforts ?? [];
  const effortIndex = Math.max(
    0,
    efforts.findIndex(
      (item) =>
        item.reasoningEffort === (effort ?? preferredCodexEffort(selected)),
    ),
  );
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
  const chooseEffort = (index: number) => {
    if (!disabled && efforts[index])
      onEffortChange(efforts[index].reasoningEffort);
  };
  return (
    <div className={`model-picker ${styles.followupPicker}`} ref={container}>
      <button
        ref={trigger}
        type="button"
        className="model-picker-trigger repo-picker"
        aria-label="Follow-up model and thinking effort"
        aria-expanded={open && !disabled}
        aria-controls={panelId}
        disabled={disabled}
        title={
          disabled
            ? "Model and effort switching is available after the current request finishes"
            : "Model and thinking effort for your next message"
        }
        onClick={() => setOpen(!open)}
      >
        <CircleDot size={15} aria-hidden="true" />
        <span>
          {selected?.label ??
            (models.length ? "Select a model" : "Connect Codex")}
        </span>
        {selected && (
          <span className="model-effort-badge">
            {effort ?? "Model default"}
          </span>
        )}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div
        id={panelId}
        className={`model-picker-panel ${styles.modelPickerPanel}`}
        hidden={!open || disabled}
      >
        <label className="model-picker-heading" htmlFor={`${panelId}-model`}>
          Model
        </label>
        {models.length ? (
          <select
            id={`${panelId}-model`}
            aria-label="Follow-up model"
            value={model}
            disabled={disabled}
            onChange={(event) => onModelChange(event.target.value)}
          >
            {!selected && <option value={model}>Select a model</option>}
            {models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        ) : (
          <a className="model-connect-link" href="/integrations">
            Connect Codex to load models
          </a>
        )}
        <div className="model-effort-section">
          <div className="model-effort-heading">
            <label htmlFor={`${panelId}-effort`}>
              <Brain size={16} aria-hidden="true" /> Thinking effort
            </label>
            <output htmlFor={`${panelId}-effort`}>
              {effort ?? "Model default"}
            </output>
          </div>
          {efforts.length ? (
            <>
              <input
                id={`${panelId}-effort`}
                type="range"
                aria-label="Follow-up thinking effort"
                min={0}
                max={Math.max(1, efforts.length - 1)}
                step={1}
                value={effortIndex}
                disabled={disabled || efforts.length < 2}
                aria-valuetext={effort ?? "Model default"}
                aria-describedby={`${panelId}-description`}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
                onChange={(event) => chooseEffort(Number(event.target.value))}
              />
              <div className="model-effort-stops">
                {efforts.map((item, index) => (
                  <button
                    type="button"
                    key={item.reasoningEffort}
                    disabled={disabled}
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
            <p>Thinking effort options are unavailable for this model.</p>
          )}
        </div>
      </div>
    </div>
  );
}
