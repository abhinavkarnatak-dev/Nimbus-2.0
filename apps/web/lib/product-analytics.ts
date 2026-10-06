const STATIC_PAGES: Record<string, string> = {
  "/": "dashboard",
  "/tasks": "history",
  "/repositories": "repositories",
  "/skills": "skills",
  "/memory": "memory",
  "/usage": "usage",
  "/audit": "audit_log",
  "/settings": "connections",
  "/instructions": "instructions",
};

export function safeAnalyticsPage(pathname: string): string {
  if (STATIC_PAGES[pathname]) return STATIC_PAGES[pathname];
  if (pathname === "/tasks/new") return "new_task";
  if (/^\/tasks\/[^/]+$/.test(pathname)) return "task_conversation";
  return "other";
}
