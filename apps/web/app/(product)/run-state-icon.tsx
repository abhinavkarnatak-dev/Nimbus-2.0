import React from "react";
import {
  Archive,
  CheckCircle2,
  CircleSlash,
  CircleX,
  Clock3,
  LoaderCircle,
} from "lucide-react";
import { sessionPresentation } from "@/lib/session-presentation";

export function RunStateIcon({
  status,
  archivedAt,
}: {
  status: string;
  archivedAt?: string | null;
}) {
  const session = sessionPresentation(status, archivedAt);
  const active = [
    "provisioning",
    "running",
    "awaiting_user",
    "preparing_pr",
    "pushing",
    "creating_pr",
  ].includes(session.state);
  const tone = archivedAt
    ? "neutral"
    : session.state === "idle"
      ? "success"
      : session.state === "failed"
        ? "failed"
        : session.state === "cancelling"
          ? "cancelling"
          : active
            ? "active"
            : "neutral";
  const Icon = archivedAt
    ? Archive
    : session.state === "idle"
      ? CheckCircle2
      : session.state === "failed"
        ? CircleX
        : session.state === "cancelled"
          ? CircleSlash
          : active || session.state === "cancelling"
            ? LoaderCircle
            : Clock3;
  return (
    <span className={`run-icon ${tone}`} aria-label={session.label} role="img">
      <Icon size={15} aria-hidden="true" />
    </span>
  );
}
