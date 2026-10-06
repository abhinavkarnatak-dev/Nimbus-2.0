"use client";

import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Copy, LoaderCircle, X } from "lucide-react";
import styles from "./codex-connection.module.css";

interface ConnectionState {
  status: string;
  verificationUrl?: string;
  userCode?: string;
  expiresAt?: number;
  account?: { email: string | null; planType: string | null };
  models?: Array<{ id: string; displayName?: string }>;
  error?: string;
}

export function CodexConnection() {
  const [connection, setConnection] = useState<ConnectionState>({
    status: "disconnected",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [modal, setModal] = useState<"connect" | "disconnect" | null>(null);
  const requestVersion = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      const version = requestVersion.current;
      try {
        const response = await fetch("/api/codex/device", {
          signal: controller.signal,
          cache: "no-store",
        });
        const result = (await response.json()) as ConnectionState;
        if (version !== requestVersion.current || controller.signal.aborted)
          return;
        if (response.ok) {
          setConnection(result);
          if (result.status === "connected") {
            setCopied(false);
            setModal((current) => (current === "connect" ? null : current));
          }
        } else
          setError(result.error ?? "Could not refresh the Codex connection.");
      } catch {
        /* Keep the last confirmed connection state during network failures. */
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!modal) return;
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    if (!appShell) return;
    const previousFilter = appShell.style.filter;
    appShell.style.filter = "blur(5px)";
    return () => {
      appShell.style.filter = previousFilter;
    };
  }, [modal]);
  async function request(method: "POST" | "DELETE") {
    requestVersion.current++;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/codex/device", { method });
      const result = (await response.json()) as ConnectionState;
      if (!response.ok)
        throw new Error(result.error ?? "Could not connect to Codex");
      setConnection(result);
      if (result.status === "connected") {
        setCopied(false);
        setModal((current) => (current === "connect" ? null : current));
      }
      if (method === "POST" && result.status === "pending") {
        setCopied(false);
        setModal("connect");
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Connection failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const connected = connection.status === "connected";
  const pending = connection.status === "pending";
  const openConnectionModal = () => {
    setCopied(false);
    setModal("connect");
  };
  return (
    <>
      <section className="connection-card">
        <div className="connection-card-header">
          <div className="connection-logo">
            <Image
              src="/integrations/codex.png"
              alt="Codex logo"
              width={32}
              height={32}
              unoptimized
            />
          </div>
          <span
            className={`connection-status connection-status-${connected ? "connected" : pending ? "waiting" : "disconnected"}`}
          >
            <span className="connection-status-dot" aria-hidden="true" />
            {connected
              ? "Active"
              : pending
                ? "Awaiting Sign-in"
                : "Not Connected"}
          </span>
        </div>
        <h2>Codex</h2>
        <p className="connection-description">
          Connect your ChatGPT account using a one-time device code.
        </p>
        <div className="connection-details" aria-live="polite">
          {pending && connection.verificationUrl && (
            <div className="codex-device-prompt">
              <p>Codex sign-in is waiting for authorization.</p>
              <button
                className="connection-action connection-action-connect"
                type="button"
                onClick={openConnectionModal}
              >
                View sign-in details <ArrowUpRight size={16} />
              </button>
            </div>
          )}
          {connected && (
            <div className="codex-device-prompt">
              <p>
                {connection.account?.email ?? "ChatGPT account connected"}
                {connection.account?.planType
                  ? ` (${connection.account.planType})`
                  : ""}
              </p>
            </div>
          )}
          {connection.status === "expired" && (
            <p role="status">Code expired. Connect again for a new code.</p>
          )}
          {connection.status === "failed" && (
            <p role="status">
              Sign-in did not complete. Enable device-code login in ChatGPT
              security settings, then try again.
            </p>
          )}
        </div>
        <div className="connection-card-footer">
          <button
            className={`connection-action ${pending || connected ? "connection-action-reconnect" : "connection-action-connect"}`}
            type="button"
            disabled={busy}
            onClick={() => {
              if (connected || pending) setModal("disconnect");
              else void request("POST");
            }}
          >
            {busy ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <ArrowUpRight size={16} />
            )}
            {busy
              ? "Please wait..."
              : pending
                ? "Cancel Codex Model"
                : connected
                  ? "Disconnect Codex"
                  : "Connect to Codex"}
          </button>
          <p className="connection-hint">
            Choose your model and thinking effort when you start a task.
          </p>
          {error && (
            <p className="codex-device-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>

      <Dialog.Root
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content className={styles.modal}>
            <Dialog.Close
              className={styles.dismiss}
              aria-label="Close Codex dialog"
            >
              <X size={18} />
            </Dialog.Close>
            {modal === "connect" ? (
              <>
                <Dialog.Title className={styles.title}>
                  Connect to Codex
                </Dialog.Title>
                <Dialog.Description className={styles.description}>
                  Open the sign-in page and enter this one-time device code.
                </Dialog.Description>
                <div className={styles.deviceCode}>
                  <code>{connection.userCode}</code>
                  <button
                    type="button"
                    aria-label="Copy device code"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(connection.userCode ?? "")
                        .then(() => setCopied(true))
                        .catch(() =>
                          setError(
                            "Could not copy. Select the code to copy it manually.",
                          ),
                        );
                    }}
                  >
                    <Copy size={15} />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <a
                  className="connection-action connection-action-connect"
                  href={connection.verificationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Codex sign-in <ArrowUpRight size={16} />
                </a>
                <p className="connection-hint">
                  Waiting for authorization. Only enter codes you requested in
                  your own Nimbus session.
                </p>
              </>
            ) : (
              <>
                <Dialog.Title className={styles.title}>
                  {pending ? "Cancel Codex sign-in?" : "Disconnect Codex?"}
                </Dialog.Title>
                <Dialog.Description className={styles.description}>
                  {pending
                    ? "Nimbus will cancel this pending Codex sign-in. You can start it again later."
                    : "Nimbus will remove the connected Codex account from this workspace. You can connect it again later."}
                </Dialog.Description>
                <div className={styles.footer}>
                  <Dialog.Close asChild>
                    <button className="button secondary" type="button">
                      {pending ? "Keep waiting" : "Cancel"}
                    </button>
                  </Dialog.Close>
                  <button
                    className="button danger"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setModal(null);
                      void request("DELETE");
                    }}
                  >
                    {busy
                      ? pending
                        ? "Canceling..."
                        : "Disconnecting..."
                      : pending
                        ? "Cancel"
                        : "Disconnect"}
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
