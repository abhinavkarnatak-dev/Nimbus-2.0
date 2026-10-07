"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { sessionPresentation } from "@/lib/session-presentation";

type Status = {
  id: string;
  status: string;
  workspaceStatus: string | null;
  archivedAt?: string | null;
  updatedAt?: string;
};
const Context = createContext<Record<string, Status>>({});
function latest(task: Status, updates: Record<string, Status>) {
  const update = updates[task.id];
  return update &&
    (!task.updatedAt || !update.updatedAt || update.updatedAt >= task.updatedAt)
    ? update
    : task;
}

// One lightweight request per list, not a stream/model lookup for every row.
export function SessionStatusProvider({
  tasks,
  children,
}: {
  tasks: Status[];
  children: ReactNode;
}) {
  const [updates, setUpdates] = useState<Record<string, Status>>({});
  const ids = tasks
    .map((task) => latest(task, updates))
    .filter((task) => !task.archivedAt && task.workspaceStatus)
    .slice(0, 100)
    .map((task) => task.id)
    .join(",");
  useEffect(() => {
    if (!ids) return;
    let controller: AbortController | undefined;
    let busy = false;
    let disposed = false;
    const refresh = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      controller = new AbortController();
      try {
        const response = await fetch(
          `/api/tasks/status?ids=${encodeURIComponent(ids)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (response.ok) {
          const body = (await response.json()) as { tasks: Status[] };
          if (!disposed)
            setUpdates((previous) => ({
              ...previous,
              ...Object.fromEntries(body.tasks.map((task) => [task.id, task])),
            }));
        }
      } catch {
        /* Leave confirmed labels intact during network failures. */
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 10_000);
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [ids]);
  return <Context.Provider value={updates}>{children}</Context.Provider>;
}

export function SessionStatusChip({ task }: { task: Status }) {
  const updates = useContext(Context);
  const current = latest(task, updates);
  const session = sessionPresentation(
    current.status,
    current.archivedAt,
    current.workspaceStatus,
  );
  return (
    <span className={`state-chip state-${session.state}`}>{session.label}</span>
  );
}
