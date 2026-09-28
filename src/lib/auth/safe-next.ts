/** Only same-site admin paths are honoured; anything else (absolute URLs, //host, other sections) falls back to the dashboard. */
export function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/admin";
  if (!/^\/admin(?:[/?#]|$)/.test(next) || next.startsWith("//") || next.includes("\\") || next.startsWith("/admin/login")) return "/admin";
  return next;
}

