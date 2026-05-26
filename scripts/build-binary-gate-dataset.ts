#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { classifyRoutingText, hashText, type Label } from "./routing-heuristics.js";

const BINARY_LABEL: Record<string, "escalate" | "continue"> = {
  planning: "escalate",
  debugging: "escalate",
  research: "escalate",
  review: "escalate",
  implementation: "continue",
  ops: "continue",
  handoff: "continue",
};

interface BinaryRow {
  id: string;
  text: string;
  label: "escalate" | "continue";
  source: string;
  sourceLabel?: Label;
  cwd?: string;
  sessionId?: string;
}

type ConflictPolicy = "keep" | "drop-exact";

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { args[key] = next; i++; }
    else args[key] = true;
  }
  const conflictPolicy = String(args["conflict-policy"] || "keep") as ConflictPolicy;
  if (conflictPolicy !== "keep" && conflictPolicy !== "drop-exact") throw new Error("--conflict-policy must be keep or drop-exact");
  return {
    goldInput: String(args.gold || path.join(process.cwd(), "data", "routing", "gold.jsonl")),
    piSessions: String(args["pi-sessions"] || path.join(process.env.HOME || "/tmp", ".pi", "agent", "sessions")),
    claudeHistory: String(args["claude-history"] || path.join(process.env.HOME || "/tmp", ".claude", "history.jsonl")),
    claudeProjects: String(args["claude-projects"] || path.join(process.env.HOME || "/tmp", ".claude", "projects")),
    output: String(args.output || path.join(process.cwd(), "data", "routing", "binary-gate.jsonl")),
    report: String(args.report || path.join(process.cwd(), "data", "routing", "binary-gate-build-report.json")),
    limit: Number(args.limit || 4000) || 4000,
    conflictPolicy,
  };
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/https?:\/\/\S+/g, " url ").replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
}

function dedupeKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return String(content ?? "").trim();
  const parts: string[] = [];
  for (const item of content) {
    if (!item) continue;
    if (typeof item === "string") { parts.push(item); continue; }
    const obj = item as Record<string, unknown>;
    if (obj.type === "text" && typeof obj.text === "string") parts.push(obj.text);
    else if (typeof obj.text === "string") parts.push(obj.text);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const rows: BinaryRow[] = [];
  const seen = new Set<string>();
  const observedLabels = new Map<string, Array<{ label: "escalate" | "continue"; source: string; sourceLabel?: Label }>>();
  const exactConflictKeys = new Set<string>();
  const observe = (text: string, label: "escalate" | "continue", source: string, sourceLabel?: Label) => {
    const key = normalize(text);
    if (!key) return;
    const prior = observedLabels.get(key) || [];
    if (prior.some((row) => row.label !== label && ((row.source === "gold" && source === "pi_session") || (row.source === "pi_session" && source === "gold")))) exactConflictKeys.add(key);
    prior.push({ label, source, sourceLabel });
    observedLabels.set(key, prior);
  };
  const add = (text: string, label: "escalate" | "continue", source: string, sourceLabel?: Label) => {
    observe(text, label, source, sourceLabel);
    const key = dedupeKey(text);
    if (seen.has(key) || text.length < 4) return;
    seen.add(key);
    rows.push({ id: hashText(text), text: text.trim(), label, source, sourceLabel });
  };

  // 1. Convert existing gold
  const gold = readJsonl<{ text: string; label: Label }>(args.goldInput);
  for (const g of gold) {
    const bin = BINARY_LABEL[g.label];
    if (bin) add(g.text, bin, "gold", g.label);
  }
  console.log(`gold converted: ${gold.length}`);

  // 2. Mine Pi sessions (use existing heuristic but map to binary)
  let piCount = 0;
  const stack = [args.piSessions];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    if (!fs.existsSync(dir)) continue;
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { stack.push(full); continue; }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const raw = fs.readFileSync(full, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const row = JSON.parse(trimmed);
          if (row?.type !== "message") continue;
          const msg = row.message;
          if (!msg || msg.role !== "user") continue;
          const text = textFromContent(msg.content);
          if (!text || text.length < 4) continue;
          const cls = classifyRoutingText(text, row.cwd || msg.cwd);
          if (!cls.label) continue;
          const bin = BINARY_LABEL[cls.label];
          if (!bin) continue;
          add(text, bin, "pi_session", cls.label);
          piCount++;
        } catch {}
      }
      if (rows.length >= args.limit) break;
    }
    if (rows.length >= args.limit) break;
  }
  console.log(`pi sessions mined: ${piCount}`);

  // 3. Mine Claude history.jsonl (display field = user prompt)
  let claudeCount = 0;
  if (fs.existsSync(args.claudeHistory)) {
    const raw = fs.readFileSync(args.claudeHistory, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed);
        const text = textFromContent(row.display || row.content || row.text || row.prompt);
        if (!text || text.length < 4) continue;
        const cls = classifyRoutingText(text, row.project || row.cwd);
        if (!cls.label) continue;
        const bin = BINARY_LABEL[cls.label];
        if (!bin) continue;
        add(text, bin, "claude_history", cls.label);
        claudeCount++;
      } catch {}
      if (rows.length >= args.limit) break;
    }
  }
  console.log(`claude history mined: ${claudeCount}`);

  // 4. Mine Claude project sessions (sample up to 200 files, no subagents)
  let claudeProjectCount = 0;
  if (fs.existsSync(args.claudeProjects)) {
    const files: string[] = [];
    const walk = (dir: string) => {
      if (files.length >= 200) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (entry.isFile() && entry.name.endsWith(".jsonl") && !entry.name.includes("subagents")) files.push(full);
        if (files.length >= 200) return;
      }
    };
    walk(args.claudeProjects);
    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, "utf8");
        for (const line of raw.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const row = JSON.parse(trimmed);
            const content = row?.messages?.find((m: any) => m.role === "user")?.content
              || row?.display
              || row?.content
              || row?.text
              || row?.prompt;
            const text = textFromContent(content);
            if (!text || text.length < 4) continue;
            const cls = classifyRoutingText(text, row.cwd);
            if (!cls.label) continue;
            const bin = BINARY_LABEL[cls.label];
            if (!bin) continue;
            add(text, bin, "claude_project", cls.label);
            claudeProjectCount++;
          } catch {}
          if (rows.length >= args.limit) break;
        }
      } catch {}
      if (rows.length >= args.limit) break;
    }
  }
  console.log(`claude project sessions mined: ${claudeProjectCount}`);

  // Output
  const beforeRows = rows.slice();
  const outputRows = args.conflictPolicy === "drop-exact"
    ? rows.filter((row) => !exactConflictKeys.has(normalize(row.text)))
    : rows;
  const binCounts = outputRows.reduce<Record<string, number>>((a, r) => { a[r.label] = (a[r.label] || 0) + 1; return a; }, {});
  const sourceCounts = outputRows.reduce<Record<string, number>>((a, r) => { a[r.source] = (a[r.source] || 0) + 1; return a; }, {});
  const removedRows = beforeRows.filter((row) => !outputRows.includes(row));
  const removedCounts = removedRows.reduce<Record<string, number>>((a, r) => { const k = `${r.source}:${r.label}`; a[k] = (a[k] || 0) + 1; return a; }, {});
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, outputRows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  fs.writeFileSync(args.report, JSON.stringify({
    output: args.output,
    conflictPolicy: args.conflictPolicy,
    beforeRows: beforeRows.length,
    rows: outputRows.length,
    removedRows: removedRows.length,
    exactConflictKeys: exactConflictKeys.size,
    binaryCounts: binCounts,
    sourceCounts,
    removedCounts,
  }, null, 2) + "\n", "utf8");

  console.log(`\n--- RESULT ---`);
  console.log(`conflict policy: ${args.conflictPolicy}`);
  console.log(`exact conflict keys: ${exactConflictKeys.size}`);
  console.log(`removed rows: ${removedRows.length}`);
  console.log(`total binary rows: ${outputRows.length}`);
  console.log(`binary counts: ${JSON.stringify(binCounts)}`);
  console.log(`source counts: ${JSON.stringify(sourceCounts)}`);
  console.log(`output: ${args.output}`);
  console.log(`report: ${args.report}`);
}

try { main(); } catch (e) { console.error(e instanceof Error ? e.stack || e.message : String(e)); process.exitCode = 1; }
