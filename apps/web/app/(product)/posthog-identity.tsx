"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";

import { safeAnalyticsPage } from "@/lib/product-analytics";

export function PostHogIdentity({
  userId,
  organizationId,
  authProvider,
}: {
  userId: string;
  organizationId: string;
  authProvider: "google" | "local";
}) {
  const pathname = usePathname();
  const enabled = Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN);

  useEffect(() => {
    if (!enabled) return;
    posthog.identify(userId);
    posthog.group("organization", organizationId);
  }, [authProvider, enabled, organizationId, userId]);

  useEffect(() => {
    if (!enabled) return;
    posthog.capture("product page viewed", {
      page: safeAnalyticsPage(pathname),
      auth_provider: authProvider,
    });
  }, [authProvider, enabled, pathname]);

  return null;
}
