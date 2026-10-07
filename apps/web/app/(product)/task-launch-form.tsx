"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";

const LaunchBusyContext = createContext(false);
const LaunchModelContext = createContext<{
  available: boolean;
  setAvailable: (available: boolean) => void;
} | null>(null);

export function useLaunchModelAvailability(model: string | undefined) {
  const update = useContext(LaunchModelContext)?.setAvailable;
  useEffect(() => {
    update?.(Boolean(model));
  }, [model, update]);
}

export function TaskLaunchButton() {
  const busy = useContext(LaunchBusyContext);
  const available = useContext(LaunchModelContext)?.available ?? false;
  const explanation = !available
    ? "Connect Codex and select a model to start sending messages."
    : undefined;
  return (
    <span
      className="launch-action"
      title={explanation}
      tabIndex={!available ? 0 : undefined}
      aria-label={explanation}
    >
      <button
        type="submit"
        className="launch-button"
        disabled={busy || !available}
        title={explanation}
      >
        {!busy && <Play size={14} fill="currentColor" />}
        {busy ? "Starting…" : "Start"}
      </button>
    </span>
  );
}

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function TaskLaunchForm({
  children,
  style,
  initialModelAvailable = false,
}: {
  children: ReactNode;
  style?: CSSProperties;
  initialModelAvailable?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [available, setAvailable] = useState(initialModelAvailable);
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const body = new FormData(event.currentTarget);
    if (!ready || !available || !String(body.get("model") ?? "").trim()) return;
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
          <LaunchModelContext.Provider value={{ available, setAvailable }}>
            {children}
          </LaunchModelContext.Provider>
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
