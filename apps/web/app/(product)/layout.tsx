import { currentIdentity } from "@/lib/auth";
import {
  Gauge,
  BookText,
  ScrollText,
  Code2,
  LayoutDashboard,
  FolderGit2,
  Plug,
  ShieldCheck,
  History,
} from "lucide-react";
import Link from "next/link";
import { CodexLimitNotice } from "./codex-limit-notice";
import { displayInitials } from "@/lib/display-initials";
import styles from "./sidebar.module.css";
import { ProfileMenu } from "./profile-menu";
import { signOut } from "@/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth";
import { googleAuthConfigured } from "@/lib/google-auth-policy";
import { PostHogIdentity } from "./posthog-identity";

const primaryLinks = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "History", icon: History },
  { href: "/repositories", label: "Repositories", icon: FolderGit2 },
] as const;

const systemLinks = [
  { href: "/skills", label: "Skills", icon: BookText },
  { href: "/usage", label: "Usage", icon: Gauge },
  { href: "/audit", label: "Audit log", icon: ShieldCheck },
  { href: "/settings", label: "Connections", icon: Plug },
  { href: "/instructions", label: "Instructions", icon: ScrollText },
] as const;

export default async function ProductLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const identity = await currentIdentity();
  if (!identity) return <>{children}</>;
  const initials = displayInitials(identity.userName);

  return (
    <div className="app-shell">
      <PostHogIdentity
        userId={identity.userId}
        organizationId={identity.organizationId}
        authProvider={identity.authProvider}
      />
      <aside className="app-sidebar">
        <Link className="app-logo" href="/" aria-label="Nimbus dashboard">
          <span className="logo-glyph">
            <svg
              className="logo-cloud-mark"
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M20.5 17.5H5.8a4.3 4.3 0 0 1-.72-8.54A6.8 6.8 0 0 1 18.3 9.7a4.1 4.1 0 0 1 2.2 7.8Z"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <Code2
              className="logo-code-mark"
              size={8}
              strokeWidth={2.1}
              aria-hidden="true"
            />
          </span>
          <span>Nimbus</span>
        </Link>

        <button
          className="org-control"
          type="button"
          aria-label="Switch organization"
        >
          <span className="org-avatar">
            {displayInitials(identity.organizationName)}
          </span>
          <span>
            <small>Workspace</small>
            <strong>{identity.organizationName}</strong>
          </span>
        </button>

        <nav
          className={`sidebar-nav ${styles.navigation}`}
          aria-label="Workspace"
        >
          <p className="nav-label">Workspace</p>
          {primaryLinks.map(({ href, label, icon: Icon }) => (
            <Link href={href} key={href} aria-label={label}>
              <Icon size={16} />
              <span>{label}</span>
            </Link>
          ))}
          <p className="nav-label nav-label-spaced">Configure</p>
          {systemLinks.map(({ href, label, icon: Icon }) => (
            <Link href={href} key={href} aria-label={label}>
              <Icon size={16} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <CodexLimitNotice />

          <ProfileMenu
            initials={initials}
            name={identity.userName}
            email={identity.email}
            signOutAction={async () => {
              "use server";
              (await cookies()).delete(SESSION_COOKIE);
              if (googleAuthConfigured()) await signOut({ redirectTo: "/" });
              redirect("/");
            }}
          />
        </div>
      </aside>

      <div className="app-frame">{children}</div>
    </div>
  );
}
