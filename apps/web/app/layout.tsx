import type { Metadata } from "next";
import { Manrope } from "next/font/google";

import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Nimbus - Cloud coding with a visible trail",
    template: "%s | Nimbus",
  },
  description:
    "Nimbus is a cloud coding agent that turns software tasks into verified, inspectable workspaces.",
  applicationName: "Nimbus",
  keywords: [
    "cloud coding agent",
    "AI software development",
    "repository automation",
    "Codex workspace",
  ],
  authors: [{ name: "Nimbus" }],
  creator: "Nimbus",
  openGraph: {
    type: "website",
    siteName: "Nimbus",
    title: "Nimbus - Cloud coding with a visible trail",
    description:
      "Ship software with an agent you can inspect. Every command, decision, and outcome stays visible.",
  },
  twitter: {
    card: "summary",
    title: "Nimbus - Cloud coding with a visible trail",
    description:
      "A cloud coding agent for verified, inspectable software workspaces.",
  },
  robots: { index: true, follow: true },
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={manrope.variable}>{children}</body>
    </html>
  );
}
