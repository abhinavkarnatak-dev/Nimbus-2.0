"use client";

import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Check,
  CircleDot,
  Code2,
  GitBranch,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import styles from "./landing-page.module.css";

export function LandingPage() {
  const [motionReady, setMotionReady] = useState(false);
  const pageRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setMotionReady(true);
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("landing-reveal-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16 },
    );
    const elements = document.querySelectorAll("[data-reveal]");
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateScroll = () => {
      const page = pageRef.current;
      if (!page) return;
      page.style.setProperty(
        "--scroll-progress",
        String(
          Math.min(1, window.scrollY / Math.max(1, window.innerHeight * 3)),
        ),
      );
    };
    updateScroll();
    window.addEventListener("scroll", updateScroll, { passive: true });
    return () => window.removeEventListener("scroll", updateScroll);
  }, []);

  const moveSpotlight = (event: PointerEvent<HTMLElement>) => {
    const page = pageRef.current;
    if (!page) return;
    page.style.setProperty("--pointer-x", `${event.clientX}px`);
    page.style.setProperty("--pointer-y", `${event.clientY}px`);
  };

  const scrollToSection = (event: MouseEvent<HTMLAnchorElement>) => {
    const targetId = event.currentTarget.getAttribute("href")?.slice(1);
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `#${targetId}`);
  };

  return (
    <main
      ref={pageRef}
      onPointerMove={moveSpotlight}
      className={`${styles.page} ${motionReady ? styles.motionReady : ""}`}
    >
      <div className={styles.noise} aria-hidden="true" />
      <div className={styles.pointerGlow} aria-hidden="true" />
      <div className={styles.scrollProgress} aria-hidden="true" />
      <nav className={styles.nav} aria-label="Main navigation">
        <Link className={styles.logo} href="/" aria-label="Nimbus home">
          <LogoMark />
          <span>Nimbus</span>
        </Link>
        <div className={styles.navLinks}>
          <a href="#how-it-works" onClick={scrollToSection}>
            How it works
          </a>
          <a href="#why-nimbus" onClick={scrollToSection}>
            Why Nimbus
          </a>
        </div>
        <div className={styles.navActions}>
          <Link className={styles.navCta} href="/sign-in">
            Start building <ArrowUpRight size={15} />
          </Link>
        </div>
      </nav>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}>
            <span className={styles.livePulse} /> Cloud coding, with receipts
          </div>
          <h1>
            Ship software.
            <span>Keep the proof.</span>
          </h1>
          <p className={styles.heroLead}>
            Nimbus is the cloud coding agent that turns an idea into a verified
            change - while keeping every decision, command, and outcome in view.
            Connect your own Codex account to power the work.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryCta} href="/sign-in">
              Start building <ArrowUpRight size={17} />
            </Link>
            <a
              className={styles.secondaryCta}
              href="#how-it-works"
              onClick={scrollToSection}
            >
              See how it works <span>↓</span>
            </a>
          </div>
          <div className={styles.heroMeta}>
            <span>
              <Check size={14} /> Isolated workspaces
            </span>
            <span>
              <Check size={14} /> Durable activity trail
            </span>
            <span>
              <Check size={14} /> Bring your own Codex account
            </span>
          </div>
        </div>

        <div className={styles.heroStage} aria-label="Nimbus agent preview">
          <div className={`${styles.orbit} ${styles.orbitOne}`} />
          <div className={`${styles.orbit} ${styles.orbitTwo}`} />
          <div className={styles.stageGlow} />
          <div className={styles.terminalCard}>
            <div className={styles.terminalTop}>
              <div className={styles.windowDots}>
                <i />
                <i />
                <i />
              </div>
              <span>nimbus / task_7f3a</span>
              <span className={styles.runningTag}>
                <span /> running
              </span>
            </div>
            <div className={styles.terminalBody}>
              <div className={styles.promptLine}>
                <span className={styles.prompt}>you</span>
                <span>Build an audit log for the new webhook flow</span>
              </div>
              <div className={styles.agentLine}>
                <span className={styles.agent}>nimbus</span>
                <span>Reading the repository and mapping the event path…</span>
              </div>
              <div className={styles.activityLine}>
                <span className={styles.activityIcon}>
                  <GitBranch size={13} />
                </span>
                Inspecting 42 files
                <span className={styles.lineTime}>3.2s</span>
              </div>
              <div className={styles.activityLine}>
                <span className={`${styles.activityIcon} ${styles.purple}`}>
                  <Code2 size={13} />
                </span>
                Writing audit-events.ts
                <span className={styles.lineTime}>8.7s</span>
              </div>
              <div className={styles.activityLine}>
                <span className={`${styles.activityIcon} ${styles.green}`}>
                  <ShieldCheck size={13} />
                </span>
                Tests passed · 18 checks
                <span className={styles.lineTime}>1.4s</span>
              </div>
              <div className={styles.cursorLine}>
                <span /> awaiting your next move
              </div>
            </div>
          </div>
          <div className={`${styles.floatCard} ${styles.floatTop}`}>
            <span className={styles.floatIcon}>
              <Activity size={14} />
            </span>
            <span>
              <strong>12 durable events</strong>
              <small>nothing hidden in the run</small>
            </span>
          </div>
          <div className={`${styles.floatCard} ${styles.floatBottom}`}>
            <span className={`${styles.floatIcon} ${styles.greenIcon}`}>
              <Check size={15} />
            </span>
            <span>
              <strong>Verified outcome</strong>
              <small>ready for review</small>
            </span>
          </div>
        </div>
      </section>

      <section
        className={styles.signalStrip}
        aria-label="Nimbus principles"
        data-reveal
      >
        <span>From intent</span>
        <i />
        <span>to evidence</span>
        <i />
        <span>to shipped software</span>
        <i />
        <span className={styles.signalAccent}>without the black box</span>
      </section>

      <section className={styles.manifesto} id="why-nimbus" data-reveal>
        <div className={styles.sectionKicker}>The Nimbus difference</div>
        <h2>
          Autonomy is useful.
          <span>Visibility makes it trustworthy.</span>
        </h2>
        <p>
          Other agents give you a chat bubble and a diff. Nimbus gives you a
          durable, inspectable workspace where the path to the result is part of
          the result.
        </p>
      </section>

      <section className={styles.featureGrid} data-reveal>
        <Feature
          icon={<Terminal size={18} />}
          number="01"
          title="A real workspace"
          text="Give Nimbus a repository, a goal, and your constraints. It works in an isolated cloud environment built for the task."
        />
        <Feature
          icon={<Activity size={18} />}
          number="02"
          title="Every move, visible"
          text="Read the agent's reasoning trail, commands, evidence, and verification as the work happens - not after the fact."
        />
        <Feature
          icon={<ShieldCheck size={18} />}
          number="03"
          title="A verified finish"
          text="Nimbus only calls work complete when the terminal result is confirmed. You always know what shipped and why."
        />
      </section>

      <section className={styles.workflow} id="how-it-works" data-reveal>
        <div className={styles.workflowIntro}>
          <div className={styles.sectionKicker}>A calmer way to build</div>
          <h2>
            One prompt.
            <br />A complete trail.
          </h2>
          <p>
            Start with the outcome you want. Nimbus handles the loops between
            context, implementation, and proof - then hands control back to you.
            You connect your own Codex account, so the agent runs with your
            account and approval.
          </p>
          <Link className={styles.textLink} href="/sign-in">
            Open your workspace <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className={styles.steps}>
          <Step
            number="01"
            title="Describe the outcome"
            text="Share the goal, constraints, and definition of done in plain language."
            icon={<Sparkles size={17} />}
          />
          <Step
            number="02"
            title="Let Nimbus investigate"
            text="The agent reads current evidence, chooses useful actions, and keeps its work isolated."
            icon={<Zap size={17} />}
          />
          <Step
            number="03"
            title="Review with confidence"
            text="Inspect the trail, files, tests, and final status before anything leaves the workspace."
            icon={<Check size={17} />}
          />
        </div>
      </section>

      <section className={styles.finalCta} data-reveal>
        <div className={styles.finalCloud} aria-hidden="true">
          <LogoMark />
        </div>
        <div>
          <div className={styles.sectionKicker}>Your next workspace</div>
          <h2>
            Make the next change
            <br />
            <span>the clearest one yet.</span>
          </h2>
        </div>
        <Link className={styles.primaryCta} href="/sign-in">
          Start building <ArrowUpRight size={17} />
        </Link>
      </section>

      <footer className={styles.footer}>
        <Link className={styles.logo} href="/" aria-label="Nimbus home">
          <LogoMark />
          <span>Nimbus</span>
        </Link>
        <span>Cloud coding with a visible trail.</span>
        <span>© {new Date().getFullYear()} Nimbus</span>
      </footer>
    </main>
  );
}

function Feature({
  icon,
  number,
  title,
  text,
}: {
  icon: ReactNode;
  number: string;
  title: string;
  text: string;
}) {
  return (
    <article className={styles.feature}>
      <div className={styles.featureTop}>
        <span className={styles.featureIcon}>{icon}</span>
        <span>{number}</span>
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function Step({
  number,
  title,
  text,
  icon,
}: {
  number: string;
  title: string;
  text: string;
  icon: ReactNode;
}) {
  return (
    <div className={styles.step}>
      <span className={styles.stepNumber}>{number}</span>
      <span className={styles.stepIcon}>{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    </div>
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
