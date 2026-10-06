export function integrationStatus(status?: string | null) {
  switch (status) {
    case "active":
      return { label: "Active", tone: "connected" } as const;
    case "suspended":
      return { label: "Suspended", tone: "waiting" } as const;
    case "pending":
    case "connecting":
      return { label: "Connecting", tone: "waiting" } as const;
    case "revoked":
      return { label: "Access Revoked", tone: "disconnected" } as const;
    case "failed":
    case "error":
      return { label: "Connection Failed", tone: "disconnected" } as const;
    case undefined:
    case null:
    case "disconnected":
      return { label: "Not Connected", tone: "disconnected" } as const;
    default:
      return { label: "Unavailable", tone: "unknown" } as const;
  }
}
