import { requireIdentity } from "@/lib/auth";
import {
  Archive,
  Blocks,
  BookOpen,
  Boxes,
  ChevronsUpDown,
  CircleGauge,
  FolderGit2,
  GitPullRequestArrow,
  MemoryStick,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

const primaryLinks = [
  { href: "/", label: "Mission control", icon: CircleGauge },
  { href: "/tasks", label: "Agent runs", icon: Sparkles },
  { href: "/repositories", label: "Repositories", icon: FolderGit2 },
  { href: "/integrations", label: "Connections", icon: Blocks },
] as const;

const systemLinks = [
  { href: "/skills", label: "Skills", icon: BookOpen },
  { href: "/memory", label: "Memory", icon: MemoryStick },
  { href: "/usage", label: "Usage", icon: Archive },
  { href: "/audit", label: "Audit log", icon: ShieldCheck },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export default async function ProductLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const identity = await requireIdentity();
  const isLiveCodex = process.env.NIMBUS_CODING_PROVIDER === "codex";
  const initials = identity.userName
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2);

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link className="app-logo" href="/" aria-label="Nimbus mission control">
          <span className="logo-glyph">
            <Boxes size={17} strokeWidth={2.2} />
          </span>
          <span>Nimbus</span>
          <span className="logo-version">2.0</span>
        </Link>

        <button
          className="org-control"
          type="button"
          aria-label="Switch organization"
        >
          <span className="org-avatar">NL</span>
          <span>
            <small>Workspace</small>
            <strong>{identity.organizationName}</strong>
          </span>
          <ChevronsUpDown size={14} />
        </button>

        <nav className="sidebar-nav" aria-label="Workspace">
          <p className="nav-label">Workspace</p>
          {primaryLinks.map(({ href, label, icon: Icon }) => (
            <Link href={href} key={href}>
              <Icon size={16} />
              <span>{label}</span>
            </Link>
          ))}
          <p className="nav-label nav-label-spaced">Configure</p>
          {systemLinks.map(({ href, label, icon: Icon }) => (
            <Link href={href} key={href}>
              <Icon size={16} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="engine-card">
          <div className="engine-line">
            <span className={isLiveCodex ? "live-dot" : "test-dot"} />
            {isLiveCodex ? "Codex app-server" : "Test provider"}
          </div>
          <p>
            {isLiveCodex
              ? "Agent runtime ready"
              : "Deterministic local simulation"}
          </p>
          <div className="engine-meta">
            <span>{isLiveCodex ? "live OAuth" : "local only"}</span>
            <span>{isLiveCodex ? "isolated" : "not live"}</span>
          </div>
        </div>

        <div className="profile-row">
          <span className="profile-avatar">{initials}</span>
          <span>
            <strong>{identity.userName}</strong>
            <small>{identity.email}</small>
          </span>
          <Settings size={15} />
        </div>
      </aside>

      <div className="app-frame">
        <header className="app-topbar">
          <div className="command-search">
            <Search size={15} />
            <span>Search tasks, repositories, and files</span>
            <kbd>⌘ K</kbd>
          </div>
          <div className="topbar-actions">
            <span className="environment-pill">
              <span className="live-dot" /> Local environment
            </span>
            <Link className="topbar-pr" href="/tasks">
              <GitPullRequestArrow size={16} /> Pull requests
            </Link>
            <Link className="new-run-button" href="/tasks/new">
              New agent run
            </Link>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
