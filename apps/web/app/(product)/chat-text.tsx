"use client";
import { useState } from "react";
import { Globe2 } from "lucide-react";
import { chatTextParts } from "@/lib/chat-links";
import styles from "./chat-text.module.css";

export function ChatText({
  text,
  className,
}: {
  text: string;
  className?: string | undefined;
}) {
  return (
    <p className={className}>
      {chatTextParts(text).map((part, index) =>
        part.href ? (
          <a
            key={index}
            className={styles.link}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${part.text}`}
          >
            <SiteIcon origin={part.origin!} />
            <span>{part.text}</span>
          </a>
        ) : (
          part.text
        ),
      )}
    </p>
  );
}

function SiteIcon({ origin }: { origin: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !origin.startsWith("https://"))
    return <Globe2 size={14} aria-hidden="true" />;
  // Load only the site's favicon, never arbitrary page HTML; no chat text or referrer is sent.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${origin}/favicon.ico`}
      width={14}
      height={14}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
