"use client";
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";

const LaunchBusyContext = createContext(false);

export function TaskLaunchButton() {
  const busy = useContext(LaunchBusyContext);
  return (
    <button type="submit" className="launch-button">
      {!busy && <Play size={14} fill="currentColor" />}
      {busy ? "Starting…" : "Start"}
    </button>
  );
}

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function TaskLaunchForm({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const body = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { accept: "application/json" },
        body,
      });
      const result = (await response.json()) as {
        error?: string;
        taskId?: string;
      };
      if (!response.ok || !result.taskId)
        throw new Error(result.error ?? "Could not start the task. Try again.");
      router.push(`/tasks/${result.taskId}`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Connection failed. Try again.",
      );
      setBusy(false);
    }
  }
  return (
    <form
      action="/api/tasks"
      method="post"
      style={style}
      onSubmit={submit}
      aria-busy={busy}
    >
      <fieldset disabled={busy || !ready} style={{ display: "contents" }}>
        <LaunchBusyContext.Provider value={busy}>
          {children}
        </LaunchBusyContext.Provider>
      </fieldset>
      {error && (
        <p className="launch-feedback launch-feedback-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
