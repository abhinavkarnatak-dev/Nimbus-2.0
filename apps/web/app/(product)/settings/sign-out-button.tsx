"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { LogOut, X } from "lucide-react";
import posthog from "posthog-js";
import styles from "./sign-out-button.module.css";

function ConfirmSignOut() {
  const { pending } = useFormStatus();
  return (
    <button className="button danger" type="submit" disabled={pending}>
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}

export function SignOutButton({
  signOutAction,
}: {
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    if (!appShell) return;
    const previousFilter = appShell.style.filter;
    appShell.style.filter = "blur(5px)";
    return () => {
      appShell.style.filter = previousFilter;
    };
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="button danger" type="button">
          <LogOut size={13} aria-hidden="true" />
          Log out
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.modal}>
          <Dialog.Close
            className={styles.dismiss}
            aria-label="Dismiss confirmation"
          >
            <X size={18} />
          </Dialog.Close>
          <Dialog.Title className={styles.title}>Log out?</Dialog.Title>
          <Dialog.Description className={styles.description}>
            Are you sure you want to log out of your account?
          </Dialog.Description>
          <form
            action={signOutAction}
            className={styles.footer}
            onSubmit={() => {
              if (process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN)
                posthog.reset();
            }}
          >
            <Dialog.Close asChild>
              <button className="button secondary" type="button">
                Cancel
              </button>
            </Dialog.Close>
            <ConfirmSignOut />
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
