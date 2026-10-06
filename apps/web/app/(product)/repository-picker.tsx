"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, GitBranch, MessageSquareText } from "lucide-react";
import styles from "./repository-picker.module.css";
import { subscribeRepositoryUpdates } from "@/lib/repository-updates";

interface RepositoryOption {
  id: string;
  fullName: string;
}
export function RepositoryPicker({
  repositories,
}: {
  repositories: RepositoryOption[];
}) {
  const [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<{
    source: RepositoryOption[];
    rows: RepositoryOption[];
  } | null>(null);
  const options =
    snapshot?.source === repositories ? snapshot.rows : repositories;
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/github/repositories", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return;
      const result = (await response.json()) as {
        repositories: RepositoryOption[];
      };
      if (!controller.signal.aborted) {
        setSnapshot({ source: repositories, rows: result.repositories });
        setSelected((previous) =>
          result.repositories.some((repo) => repo.id === previous)
            ? previous
            : "",
        );
      }
    } catch {
      // Retain the last confirmed list on network failure; retry on open/focus.
    }
  }, [repositories]);
  useEffect(() => {
    const update = () => {
      void refresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible") update();
    };
    update();
    const unsubscribe = subscribeRepositoryUpdates(update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", visible);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", visible);
      request.current?.abort();
    };
  }, [refresh]);
  const current = options.find((repository) => repository.id === selected);
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
  return (
    <div className="model-picker repository-picker" ref={container}>
      <input type="hidden" name="repositoryId" value={current?.id ?? ""} />
      <button
        type="button"
        ref={trigger}
        className="model-picker-trigger repo-picker"
        aria-label="Choose repository"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) void refresh();
        }}
      >
        <GitBranch size={15} aria-hidden="true" />
        <span>{current?.fullName ?? "No repository"}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="model-picker-panel repository-picker-panel"
          role="group"
          aria-label="Repository selection"
        >
          <span className="model-picker-heading">Repository</span>
          <div className={`repository-options ${styles.options}`}>
            <button
              type="button"
              className="repository-option"
              aria-pressed={!current}
              onClick={() => {
                setSelected("");
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <MessageSquareText size={15} aria-hidden="true" />
              <span>No repository - general chat</span>
              {!current && <Check size={15} aria-hidden="true" />}
            </button>
            {options.length ? (
              options.map((repository) => (
                <button
                  type="button"
                  key={repository.id}
                  className="repository-option"
                  title={repository.fullName}
                  aria-pressed={repository.id === current?.id}
                  onClick={() => {
                    setSelected(repository.id);
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                >
                  <GitBranch size={15} aria-hidden="true" />
                  <span>{repository.fullName}</span>
                  {repository.id === current?.id && (
                    <Check size={15} aria-hidden="true" />
                  )}
                </button>
              ))
            ) : (
              <p>Connect GitHub to choose a repository.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
