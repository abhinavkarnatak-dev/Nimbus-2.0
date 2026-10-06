"use client";

import { useEffect, useRef } from "react";
import { SignOutButton } from "./settings/sign-out-button";
import styles from "./profile-menu.module.css";

export function ProfileMenu({
  initials,
  name,
  email,
  signOutAction,
}: {
  initials: string;
  name: string;
  email: string;
  signOutAction: () => Promise<void>;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && menu.current) menu.current.open = false;
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details ref={menu} className={styles.profile}>
      <summary className={`profile-row ${styles.trigger}`} aria-label="Profile">
        <span className="profile-avatar">{initials}</span>
        <span>
          <strong>{name}</strong>
          <small>{email}</small>
        </span>
      </summary>
      <div className={styles.menu}>
        <SignOutButton signOutAction={signOutAction} />
      </div>
    </details>
  );
}
