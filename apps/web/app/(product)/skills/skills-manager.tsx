"use client";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { BookText, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { skillSchema, type SkillSnapshot } from "@nimbus/shared";
import styles from "./skills.module.css";

const empty = { name: "", description: "", summary: "" };
export function SkillsManager({
  initialSkills,
  readOnly,
}: {
  initialSkills: SkillSnapshot[];
  readOnly: boolean;
}) {
  const [skills, setSkills] = useState(initialSkills);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState(empty);
  const [deleteTarget, setDeleteTarget] = useState<SkillSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const addMenu = useRef<HTMLDivElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  const modalOpen = Boolean(editing || deleteTarget);

  useEffect(() => {
    if (!modalOpen) return;
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    if (!appShell) return;
    const previousFilter = appShell.style.filter;
    appShell.style.filter = "blur(5px)";
    return () => {
      appShell.style.filter = previousFilter;
    };
  }, [modalOpen]);

  useEffect(() => {
    if (!editing && !deleteTarget && !addOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAddOpen(false);
        if (!busy) {
          setEditing(null);
          setDeleteTarget(null);
        }
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (addOpen && !addMenu.current?.contains(event.target as Node))
        setAddOpen(false);
      if (event.target === modal.current && !busy) {
        setEditing(null);
        setDeleteTarget(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [addOpen, busy, editing, deleteTarget]);

  function startCreate() {
    setDraft(empty);
    setEditing("new");
    setAddOpen(false);
    setError("");
    setNotice("");
  }

  function parseSkillFile(text: string, filename: string) {
    const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    if (!normalized.startsWith("---\n"))
      return {
        frontmatter: false,
        name: filename.replace(/\.(md|txt)$/i, "").trim() || "Imported skill",
        description: "Imported skill",
        summary: normalized.trim(),
      };
    const closing = normalized.indexOf("\n---", 4);
    if (closing < 0)
      throw new Error("The skill frontmatter is missing its closing ---.");
    const values = new Map<string, string>();
    for (const line of normalized.slice(4, closing).split("\n")) {
      const separator = line.indexOf(":");
      if (separator > 0)
        values.set(
          line.slice(0, separator).trim().toLowerCase(),
          line.slice(separator + 1).trim(),
        );
    }
    return {
      frontmatter: true,
      name: values.get("name") ?? "",
      description: values.get("description") ?? "",
      summary: normalized.slice(closing + 4).trim(),
    };
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      if (!/\.(md|txt)$/i.test(file.name) || file.size > 80000)
        throw new Error("Choose an MD or TXT file up to 80 KB.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      const imported = parseSkillFile(text, file.name);
      if (
        !imported.summary.trim() ||
        imported.summary.length > 20000 ||
        imported.summary.includes("\0")
      )
        throw new Error("Use plain UTF-8 text up to 20,000 characters.");
      setDraft((value) => ({
        name: imported.frontmatter
          ? imported.name
          : value.name || imported.name,
        description: imported.frontmatter
          ? imported.description
          : value.description || imported.description,
        summary: imported.summary,
      }));
      setEditing("new");
      setAddOpen(false);
      setNotice(`Loaded ${file.name}. Review the fields, then save the skill.`);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not read file",
      );
    }
  }
  async function mutate(method: string, body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/skills", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save skill");
      const refreshed = await fetch("/api/skills", { cache: "no-store" });
      if (!refreshed.ok)
        throw new Error(
          "Saved, but could not refresh the list. Reload the page.",
        );
      setSkills((await refreshed.json()).skills);
      setEditing(null);
      setDeleteTarget(null);
      setNotice(
        method === "DELETE"
          ? "Skill deleted. Existing request snapshots are preserved."
          : "Skill saved. Select it by typing / in a chat.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not save skill",
      );
    } finally {
      setBusy(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const parsed = skillSchema.safeParse(draft);
    if (!parsed.success) {
      setError("Name, description, and summary are required.");
      return;
    }
    void mutate(editing === "new" ? "POST" : "PUT", {
      ...parsed.data,
      ...(editing !== "new" ? { id: editing } : {}),
    });
  }
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Skills</p>
          <h1>Your skills</h1>
          <p className="lede">
            Reusable guidance you can select with / in any chat.
          </p>
        </div>
        <div className={styles.addMenu} ref={addMenu}>
          <button
            className="button"
            disabled={busy || readOnly}
            onClick={() => setAddOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={addOpen}
          >
            <Plus size={15} /> Add
          </button>
          {addOpen && (
            <div className={styles.addMenuItems} role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAddOpen(false);
                  setTimeout(() => fileInput.current?.click(), 0);
                }}
              >
                <Upload size={15} />
                Upload skill
              </button>
              <button type="button" role="menuitem" onClick={startCreate}>
                <Pencil size={15} />
                Create a skill
              </button>
            </div>
          )}
        </div>
      </div>
      <input
        hidden
        ref={fileInput}
        type="file"
        accept=".md,.txt,text/plain,text/markdown"
        aria-label="Skill summary file"
        onChange={(event) => void importFile(event)}
      />
      {(editing || deleteTarget) &&
        createPortal(
          <>
            <div className={styles.modalBackdrop} aria-hidden="true" />
            <div className={styles.modalLayer} ref={modal} role="presentation">
              {deleteTarget ? (
                <div
                  className={`card ${styles.deleteModal}`}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="delete-skill-title"
                >
                  <div className={styles.editorHeading}>
                    <h2 id="delete-skill-title">Delete skill?</h2>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Close delete dialog"
                      onClick={() => setDeleteTarget(null)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <p>
                    Delete <strong>{deleteTarget.name}</strong>? It will no
                    longer be available for new chats. Existing request
                    snapshots are preserved.
                  </p>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className="button danger"
                      disabled={busy}
                      onClick={() =>
                        void mutate("DELETE", { id: deleteTarget.id })
                      }
                    >
                      <Trash2 size={14} /> Delete skill
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => setDeleteTarget(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  className={`card ${styles.editor}`}
                  onSubmit={save}
                  aria-label="Skill editor"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="skill-editor-title"
                >
                  <fieldset disabled={busy}>
                    <div className={styles.editorHeading}>
                      <h2 id="skill-editor-title">
                        {editing === "new" ? "Create skill" : "Edit skill"}
                      </h2>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Close skill editor"
                        onClick={() => setEditing(null)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <label>
                      Name
                      <input
                        aria-label="Name"
                        value={draft.name}
                        required
                        maxLength={100}
                        onChange={(event) =>
                          setDraft({ ...draft, name: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Description
                      <textarea
                        aria-label="Description"
                        value={draft.description}
                        required
                        maxLength={500}
                        rows={2}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            description: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Summary
                      <textarea
                        aria-label="Summary"
                        value={draft.summary}
                        required
                        maxLength={20000}
                        rows={8}
                        placeholder="The instructions Nimbus should follow when this skill is selected."
                        onChange={(event) =>
                          setDraft({ ...draft, summary: event.target.value })
                        }
                      />
                    </label>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => fileInput.current?.click()}
                      >
                        <Upload size={14} />
                        Add file
                      </button>
                      <span className="muted">
                        MD or TXT replaces the summary. Up to 20,000 characters.
                      </span>
                    </div>
                    <div className={styles.actions}>
                      <button className="button" type="submit">
                        {busy ? "Saving..." : "Save skill"}
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </fieldset>
                </form>
              )}
            </div>
          </>,
          document.body,
        )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      <section className={`card ${styles.list}`} aria-label="Saved skills">
        {skills.length ? (
          <table className={`table ${styles.skillsTable}`}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr key={skill.id}>
                  <td>
                    <span className={styles.skillName}>
                      <BookText size={12} aria-hidden="true" />
                      <strong>{skill.name}</strong>
                    </span>
                  </td>
                  <td>
                    <span
                      className={styles.description}
                      title={skill.description}
                    >
                      {skill.description}
                    </span>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <>
                        <button
                          className="icon-button"
                          aria-label={`Edit ${skill.name}`}
                          disabled={busy || readOnly}
                          onClick={() => {
                            setDraft(skill);
                            setEditing(skill.id);
                            setError("");
                            setNotice("");
                          }}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className={`icon-button ${styles.deleteIcon}`}
                          aria-label={`Delete ${skill.name}`}
                          disabled={busy || readOnly}
                          onClick={() => setDeleteTarget(skill)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">
            No skills yet. Create one or upload its summary to get started.
          </div>
        )}
      </section>
    </>
  );
}
