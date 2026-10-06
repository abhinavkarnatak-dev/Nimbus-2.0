"use client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from "react";
import { X } from "lucide-react";
import type { SkillSnapshot } from "@nimbus/shared";
import styles from "./skill-prompt.module.css";

type Props = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> & {
  value?: string;
  onValueChange?: (value: string) => void;
  skillIds?: string[];
  onSkillsChange?: (ids: string[]) => void;
};
export function SkillPrompt({
  value,
  onValueChange,
  skillIds,
  onSkillsChange,
  ...props
}: Props) {
  const [localText, setLocalText] = useState("");
  const [localIds, setLocalIds] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<SkillSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [slash, setSlash] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [index, setIndex] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const text = value ?? localText,
    ids = skillIds ?? localIds;
  function changeText(next: string) {
    setLocalText(next);
    onValueChange?.(next);
  }
  function changeIds(next: string[]) {
    setLocalIds(next);
    onSkillsChange?.(next);
  }
  async function load() {
    try {
      const response = await fetch("/api/skills", { cache: "no-store" });
      if (!response.ok)
        throw new Error("Could not load skills. Try typing / again.");
      setCatalog((await response.json()).skills);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not load skills",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let mounted = true;
    void fetch("/api/skills", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Could not load skills. Try typing / again.");
        return response.json() as Promise<{ skills: SkillSnapshot[] }>;
      })
      .then((result) => {
        if (mounted) {
          setCatalog(result.skills);
          if (
            skillIds &&
            onSkillsChange &&
            skillIds.some(
              (id) => !result.skills.some((skill) => skill.id === id),
            )
          )
            onSkillsChange(
              skillIds.filter((id) =>
                result.skills.some((skill) => skill.id === id),
              ),
            );
        }
      })
      .catch(() => {
        if (mounted) setError("Could not load skills. Try typing / again.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [skillIds, onSkillsChange]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setSlash(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const matches = catalog.filter(
    (skill) =>
      !ids.includes(skill.id) &&
      `${skill.name} ${skill.description}`
        .toLowerCase()
        .includes(slash?.query.toLowerCase() ?? ""),
  );
  function inspect(next: string, caret: number) {
    const match = /(?:^|\s)\/([^\s/]*)$/.exec(next.slice(0, caret));
    setSlash(
      match
        ? { start: caret - match[1]!.length - 1, end: caret, query: match[1]! }
        : null,
    );
    setIndex(0);
    if (match && !slash) {
      setLoading(true);
      setError("");
      void load();
    }
  }
  function choose(skill: SkillSnapshot) {
    if (!slash || ids.length >= 3) return;
    const next = text.slice(0, slash.start) + text.slice(slash.end);
    changeText(next);
    changeIds([...ids, skill.id]);
    setSlash(null);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(slash.start, slash.start);
    });
  }
  return (
    <div className={styles.root} ref={root}>
      {ids.length > 0 && (
        <div className={styles.chips} aria-label="Selected skills">
          {ids.map((id) => (
            <span key={id}>
              {catalog.find((skill) => skill.id === id)?.name ??
                (loading ? "Loading skill..." : "Unavailable skill")}
              <button
                type="button"
                disabled={props.disabled}
                aria-label={`Remove skill ${catalog.find((skill) => skill.id === id)?.name ?? id}`}
                onClick={() =>
                  changeIds(ids.filter((selected) => selected !== id))
                }
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        {...props}
        ref={textarea}
        value={text}
        aria-controls={slash ? menuId : undefined}
        onChange={(event) => {
          changeText(event.target.value);
          inspect(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={(event) => {
          if (!slash) return;
          if (event.key === "Escape") {
            event.preventDefault();
            setSlash(null);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setIndex((current) =>
              Math.max(
                0,
                Math.min(
                  matches.length - 1,
                  current + (event.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          } else if (
            event.key === "Enter" &&
            matches[index] &&
            !loading &&
            !error &&
            ids.length < 3
          ) {
            event.preventDefault();
            choose(matches[index]!);
          }
        }}
      />
      {props.name === "objective" && (
        <input type="hidden" name="skillIds" value={JSON.stringify(ids)} />
      )}
      {slash && (
        <div
          className={styles.menu}
          id={menuId}
          role="listbox"
          aria-label="Choose a skill"
        >
          <div className={styles.hint}>
            Skills - selected skills stay active in this chat
          </div>
          {loading ? (
            <p>Loading skills...</p>
          ) : error ? (
            <p role="alert">{error}</p>
          ) : ids.length >= 3 ? (
            <p>Up to 3 skills per chat. Remove one to select another.</p>
          ) : matches.length ? (
            matches.map((skill, position) => (
              <button
                type="button"
                role="option"
                aria-selected={position === index}
                key={skill.id}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(skill)}
              >
                <strong>{skill.name}</strong>
                <span>{skill.description}</span>
              </button>
            ))
          ) : (
            <p>No matching skills. Create one in the Skills tab.</p>
          )}
        </div>
      )}
    </div>
  );
}
