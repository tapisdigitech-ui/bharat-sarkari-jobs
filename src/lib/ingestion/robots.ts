/**
 * Minimal robots.txt reader (RFC 9309 subset): groups by user-agent, Allow/Disallow with longest-match precedence,
 * `*` and `$` wildcards, Crawl-delay. We honour it for every official source — this platform never works around a site's
 * access rules.
 */
export interface RobotsRules { allow: string[]; disallow: string[]; crawlDelaySec?: number }
export interface Robots { groups: Map<string, RobotsRules> }

export function parseRobots(text: string): Robots {
  const groups = new Map<string, RobotsRules>();
  let agents: string[] = []; let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(); const val = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent) agents = [];
      agents.push(val.toLowerCase());
      for (const a of agents) if (!groups.has(a)) groups.set(a, { allow: [], disallow: [] });
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    for (const a of agents) {
      const g = groups.get(a)!;
      if (key === "allow" && val) g.allow.push(val);
      else if (key === "disallow" && val) g.disallow.push(val);
      else if (key === "crawl-delay") { const n = Number(val); if (Number.isFinite(n) && n >= 0) g.crawlDelaySec = n; }
    }
  }
  return { groups };
}

function rulesFor(r: Robots, agentToken: string): RobotsRules | undefined {
  const token = agentToken.toLowerCase();
  for (const [name, rules] of r.groups) if (name !== "*" && token.includes(name)) return rules;
  return r.groups.get("*");
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

/** Is `path` (path + query) allowed for this agent? Longest matching rule wins; Allow wins ties. No rules → allowed. */
export function robotsAllows(r: Robots, agentToken: string, path: string): boolean {
  const rules = rulesFor(r, agentToken);
  if (!rules) return true;
  let best: { len: number; allow: boolean } | null = null;
  for (const [list, allow] of [[rules.allow, true], [rules.disallow, false]] as const) {
    for (const p of list) {
      if (toRegex(p).test(path)) {
        const len = p.replace(/\*/g, "").length;
        if (!best || len > best.len || (len === best.len && allow)) best = { len, allow };
      }
    }
  }
  return best ? best.allow : true;
}

export function robotsCrawlDelay(r: Robots, agentToken: string): number | undefined {
  return rulesFor(r, agentToken)?.crawlDelaySec;
}
