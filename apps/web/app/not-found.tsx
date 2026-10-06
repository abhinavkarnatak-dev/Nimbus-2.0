import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import styles from "./not-found.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  description: "This Nimbus workspace route could not be found.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.grid} aria-hidden="true" />
      <div className={styles.glow} aria-hidden="true" />
      <nav className={styles.nav}>
        <Link href="/" className={styles.logo} aria-label="Nimbus home">
          <LogoMark />
          <span>Nimbus</span>
        </Link>
        <span className={styles.status}>route not found</span>
      </nav>
      <section className={styles.content}>
        <div className={styles.code}>404</div>
        <p className={styles.eyebrow}>The agent looked everywhere</p>
        <h1>This path didn’t make it into the workspace.</h1>
        <p className={styles.copy}>
          The page may have moved, expired, or never existed. Let’s get you back
          to a place where the trail is visible.
        </p>
        <div className={styles.actions}>
          <Link href="/" className={styles.primary}>
            Back to Nimbus <ArrowUpRight size={16} />
          </Link>
          <Link href="/sign-in" className={styles.secondary}>
            <ArrowLeft size={15} /> Sign in
          </Link>
        </div>
        <div className={styles.terminal} aria-hidden="true">
          <div className={styles.terminalHead}>
            <span>
              <i />
              <i />
              <i />
            </span>
            nimbus / navigator
            <em>idle</em>
          </div>
          <div className={styles.terminalBody}>
            <p>
              <b>you</b> tried to open a missing route
            </p>
            <p>
              <b className={styles.agent}>nimbus</b> searched the workspace
            </p>
            <p className={styles.result}>
              → no durable event found<span>_</span>
            </p>
          </div>
        </div>
      </section>
      <footer className={styles.footer}>
        Cloud coding with a visible trail.
      </footer>
    </main>
  );
}

function LogoMark() {
  return (
    <span className={styles.logoMark} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
        <path
          d="M20.5 17.5H5.8a4.3 4.3 0 0 1-.72-8.54A6.8 6.8 0 0 1 18.3 9.7a4.1 4.1 0 0 1 2.2 7.8Z"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="m9.5 11-2.5 2.5 2.5 2.5m5-5 2.5 2.5-2.5 2.5m-2-6-2 7"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
