"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Check, Code2, GitBranch, ShieldCheck } from "lucide-react";
import styles from "./landing-page.module.css";

const PROMPT = "Build an audit log for the new webhook flow";
const RESPONSE = "Reading the repository and mapping the event path...";
export const HERO_DEMO_DURATION = 16000;

export function heroDemoFrame(time: number) {
  const t =
    ((time % HERO_DEMO_DURATION) + HERO_DEMO_DURATION) % HERO_DEMO_DURATION;
  const count = (start: number, duration: number, text: string) =>
    Math.min(
      text.length,
      Math.max(0, Math.floor(((t - start) / duration) * text.length)),
    );
  return {
    prompt: PROMPT.slice(0, count(350, 1900, PROMPT)),
    response: RESPONSE.slice(0, count(2700, 2100, RESPONSE)),
    phase:
      t < 2700
        ? "message"
        : t < 5200
          ? "reading"
          : t < 7300
            ? "inspecting"
            : t < 9900
              ? "writing"
              : t < 11600
                ? "verified"
                : "complete",
    inspecting: t >= 5200,
    writing: t >= 7300,
    verified: t >= 9900,
    complete: t >= 11600,
    opacity:
      t < 250 ? t / 250 : t < 14500 ? 1 : Math.max(0, 1 - (t - 14500) / 900),
  };
}

const finalFrame = { ...heroDemoFrame(12000), opacity: 1 };

export function HeroTaskDemo() {
  const stage = useRef<HTMLDivElement>(null);
  const topBadge = useRef<HTMLDivElement>(null);
  const bottomBadge = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(() => heroDemoFrame(0));

  useEffect(() => {
    const root = stage.current;
    const top = topBadge.current;
    const bottom = bottomBadge.current;
    if (!root || !top || !bottom) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let geometry = { x: 0, y: 0 };
    const measure = () => {
      // Native CSS anchors remain the source of truth at every breakpoint.
      geometry = {
        x:
          (top.offsetLeft +
            top.offsetWidth / 2 -
            bottom.offsetLeft -
            bottom.offsetWidth / 2) /
          2,
        y:
          (top.offsetTop +
            top.offsetHeight / 2 -
            bottom.offsetTop -
            bottom.offsetHeight / 2) /
          2,
      };
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    resize.observe(top);
    resize.observe(bottom);
    let visible = false;
    let elapsed = 0;
    let previous: number | null = null;
    let lastTextUpdate = -100;
    let animation = 0;
    let lastFrame = "";
    const render = (now: number) => {
      elapsed += previous === null ? 0 : now - previous;
      previous = now;
      const angle = (elapsed / HERO_DEMO_DURATION) * Math.PI * 2;
      const cos = Math.cos(angle),
        sin = Math.sin(angle);
      const dx = geometry.x * (cos - 1) - geometry.y * 0.75 * sin;
      const dy = geometry.y * (cos - 1) + geometry.x * 0.75 * sin;
      top.style.translate = `${dx}px ${dy}px`;
      bottom.style.translate = `${-dx}px ${-dy}px`;
      top.style.zIndex = cos >= 0 ? "3" : "0";
      bottom.style.zIndex = cos >= 0 ? "0" : "3";
      if (elapsed - lastTextUpdate >= 45) {
        const next = heroDemoFrame(elapsed);
        const key = JSON.stringify(next);
        if (key !== lastFrame) {
          setFrame(next);
          lastFrame = key;
        }
        lastTextUpdate = elapsed;
      }
      animation = requestAnimationFrame(render);
    };
    const sync = () => {
      cancelAnimationFrame(animation);
      previous = null;
      const playing = visible && !document.hidden && !reduced.matches;
      root.dataset.demoPaused = String(!playing);
      if (reduced.matches) {
        setFrame(finalFrame);
        top.style.translate = bottom.style.translate = "0px 0px";
        top.style.zIndex = "3";
        bottom.style.zIndex = "0";
      } else if (playing) animation = requestAnimationFrame(render);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      sync();
    });
    observer.observe(root);
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      cancelAnimationFrame(animation);
      observer.disconnect();
      resize.disconnect();
      reduced.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <div
      ref={stage}
      className={styles.heroStage}
      role="img"
      aria-label="Nimbus task demo: send a message, inspect the repository, write the change, pass verification, and await your next move."
      data-hero-demo
      data-demo-phase={frame.phase}
    >
      <div className={`${styles.orbit} ${styles.orbitOne}`} />
      <div className={`${styles.orbit} ${styles.orbitTwo}`} />
      <div className={styles.stageGlow} />
      <div className={styles.terminalCard} aria-hidden="true">
        <div className={styles.terminalTop}>
          <div className={styles.windowDots}>
            <i />
            <i />
            <i />
          </div>
          <span>nimbus / task_7f3a</span>
          <span className={styles.runningTag}>
            <span />{" "}
            {frame.complete
              ? "ready for review"
              : frame.phase === "message"
                ? "new task"
                : "running"}
          </span>
        </div>
        <div className={styles.terminalBody} style={{ opacity: frame.opacity }}>
          <div className={styles.promptLine}>
            <span className={styles.prompt}>you</span>
            <StreamText
              full={PROMPT}
              text={frame.prompt}
              typing={
                frame.phase === "message" && frame.prompt.length < PROMPT.length
              }
            />
          </div>
          <div
            className={styles.agentLine}
            data-visible={frame.phase !== "message"}
          >
            <span className={styles.agent}>nimbus</span>
            <StreamText
              full={RESPONSE}
              text={frame.response}
              typing={
                frame.phase === "reading" &&
                frame.response.length < RESPONSE.length
              }
            />
          </div>
          <div className={styles.activityLine} data-visible={frame.inspecting}>
            <span className={styles.activityIcon}>
              <GitBranch size={13} />
            </span>
            Inspecting 42 files<span className={styles.lineTime}>3.2s</span>
          </div>
          <div className={styles.activityLine} data-visible={frame.writing}>
            <span className={`${styles.activityIcon} ${styles.purple}`}>
              <Code2 size={13} />
            </span>
            Writing audit-events.ts<span className={styles.lineTime}>8.7s</span>
          </div>
          <div className={styles.activityLine} data-visible={frame.verified}>
            <span className={`${styles.activityIcon} ${styles.green}`}>
              <ShieldCheck size={13} />
            </span>
            Tests passed · 18 checks
            <span className={styles.lineTime}>1.4s</span>
          </div>
          <div className={styles.cursorLine} data-visible={frame.complete}>
            <span /> awaiting your next move
          </div>
        </div>
      </div>
      <div
        ref={topBadge}
        className={`${styles.floatCard} ${styles.floatTop}`}
        data-orbit-badge="events"
        aria-hidden="true"
      >
        <span className={styles.floatIcon}>
          <Activity size={14} />
        </span>
        <span>
          <strong>12 durable events</strong>
          <small>nothing hidden in the run</small>
        </span>
      </div>
      <div
        ref={bottomBadge}
        className={`${styles.floatCard} ${styles.floatBottom}`}
        data-orbit-badge="outcome"
        aria-hidden="true"
      >
        <span className={`${styles.floatIcon} ${styles.greenIcon}`}>
          <Check size={15} />
        </span>
        <span>
          <strong>Verified outcome</strong>
          <small>ready for review</small>
        </span>
      </div>
    </div>
  );
}

function StreamText({
  full,
  text,
  typing,
}: {
  full: string;
  text: string;
  typing: boolean;
}) {
  return (
    <span className={styles.streamText}>
      <span className={styles.streamMeasure}>{full}</span>
      <span className={styles.streamContent}>
        {text}
        {typing && <i className={styles.typingCursor} />}
      </span>
    </span>
  );
}
