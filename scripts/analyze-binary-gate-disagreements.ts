#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DIR = path.join(process.cwd(), "data", "routing");
const DEFAULT_REPORT = path.join(DEFAULT_DIR, "binary-disagreements-report.json");
const DEFAULT_MARKDOWN = path.join(DEFAULT_DIR, "binary-disagreements.md");

type IntentLabel = "planning" | "implementation" | "debugging" | "review" | "research" | "ops" | "handoff" | "drop";
type BinaryLabel = "escalate" | "continue";

const BINARY_LABEL: Record<string, BinaryLabel | undefined> = {
  planning: "escalate",
  debugging: "escalate",
  research: "escalate",
  review: "escalate",
  implementation: "continue",
  ops: "continue",
  handoff: "continue",
};

interface SourceRow {
  text: string;
  label: IntentLabel | BinaryLabel;
  binary: BinaryLabel;
  source: string;
  sourceLabel?: string;
  sessionFile?: string;
  messageId?: string;
  cwd?: string;
}

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
  return {
    dir: String(args.dir || DEFAULT_DIR),
    report: String(args.report || DEFAULT_REPORT),
    markdown: String(args.markdown || DEFAULT_MARKDOWN),
    threshold: Number(args.threshold || 0.72) || 0.72,
    limit: Number(args.limit || 80) || 80,
  };
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/https?:\/\/\S+/g, " url ").replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter((token) => token.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function truncate(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function countBy<T>(rows: T[], fn: (row: T) => string | undefined): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = fn(row) || "missing";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function rowsFromGold(dir: string): SourceRow[] {
  return readJsonl<any>(path.join(dir, "gold.jsonl"))
    .map((row) => {
      const binary = BINARY_LABEL[String(row.label)];
      if (!binary || !row.text) return null;
      return { text: String(row.text), label: row.label, binary, source: "gold", sourceLabel: row.label, sessionFile: row.sessionFile, messageId: row.messageId, cwd: row.cwd } satisfies SourceRow;
    })
    .filter((row): row is SourceRow => Boolean(row));
}

function rowsFromExamples(dir: string): SourceRow[] {
  return readJsonl<any>(path.join(dir, "examples.jsonl"))
    .map((row) => {
      const binary = BINARY_LABEL[String(row.label)];
      if (!binary || !row.text) return null;
      return { text: String(row.text), label: row.label, binary, source: "pi_examples", sourceLabel: row.label, sessionFile: row.sessionFile, messageId: row.messageId, cwd: row.cwd } satisfies SourceRow;
    })
    .filter((row): row is SourceRow => Boolean(row));
}

function rowsFromBinary(dir: string): SourceRow[] {
  return readJsonl<any>(path.join(dir, "binary-gate.jsonl"))
    .map((row) => {
      if (!row.text || (row.label !== "escalate" && row.label !== "continue")) return null;
      return { text: String(row.text), label: row.label, binary: row.label, source: `binary:${row.source || "unknown"}`, sourceLabel: row.sourceLabel, cwd: row.cwd } satisfies SourceRow;
    })
    .filter((row): row is SourceRow => Boolean(row));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const gold = rowsFromGold(args.dir);
  const examples = rowsFromExamples(args.dir);
  const binary = rowsFromBinary(args.dir);
  const all = [...gold, ...examples, ...binary];

  const exactGroups = new Map<string, SourceRow[]>();
  for (const row of all) {
    const key = normalize(row.text);
    if (!key) continue;
    if (!exactGroups.has(key)) exactGroups.set(key, []);
    exactGroups.get(key)!.push(row);
  }

  const exactConflicts = [...exactGroups.entries()]
    .map(([key, rows]) => ({ key, rows, labels: Array.from(new Set(rows.map((row) => row.binary))) }))
    .filter((group) => group.labels.length > 1)
    .map((group) => ({
      text: group.rows[0].text,
      labels: group.labels,
      sources: group.rows.map((row) => ({ source: row.source, label: row.label, sourceLabel: row.sourceLabel, sessionFile: row.sessionFile, messageId: row.messageId })),
    }));

  const nonGold = [...examples, ...binary.filter((row) => !row.source.endsWith(":gold"))];
  const nonGoldByBinary = nonGold.map((row) => ({ row, toks: tokens(row.text) }));
  const nearConflicts = [] as Array<{ gold: SourceRow; other: SourceRow; similarity: number }>;
  for (const g of gold) {
    const gt = tokens(g.text);
    let best: { row: SourceRow; similarity: number } | undefined;
    for (const candidate of nonGoldByBinary) {
      if (candidate.row.binary === g.binary) continue;
      const similarity = jaccard(gt, candidate.toks);
      if (similarity >= args.threshold && (!best || similarity > best.similarity)) best = { row: candidate.row, similarity };
    }
    if (best) nearConflicts.push({ gold: g, other: best.row, similarity: best.similarity });
  }
  nearConflicts.sort((a, b) => b.similarity - a.similarity);

  const report = {
    inputs: {
      gold: path.join(args.dir, "gold.jsonl"),
      examples: path.join(args.dir, "examples.jsonl"),
      binary: path.join(args.dir, "binary-gate.jsonl"),
    },
    counts: {
      gold: gold.length,
      examples: examples.length,
      binary: binary.length,
      all: all.length,
    },
    binaryCounts: countBy(all, (row) => `${row.source}:${row.binary}`),
    exactConflicts: {
      count: exactConflicts.length,
      sample: exactConflicts.slice(0, args.limit),
    },
    nearGoldOppositeConflicts: {
      threshold: args.threshold,
      count: nearConflicts.length,
      sample: nearConflicts.slice(0, args.limit).map((item) => ({
        similarity: item.similarity,
        gold: { text: item.gold.text, binary: item.gold.binary, sourceLabel: item.gold.sourceLabel, sessionFile: item.gold.sessionFile, messageId: item.gold.messageId },
        other: { text: item.other.text, binary: item.other.binary, source: item.other.source, sourceLabel: item.other.sourceLabel, sessionFile: item.other.sessionFile, messageId: item.other.messageId },
      })),
    },
    implication: exactConflicts.length > 0 || nearConflicts.length > 0
      ? "Review disagreements before training; weak held-out gold may reflect label/source inconsistency as much as model capacity."
      : "No obvious exact or near-duplicate binary disagreements found at this threshold; investigate feature capacity and class mapping next.",
  };

  fs.mkdirSync(path.dirname(args.report), { recursive: true });
  fs.writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const md = [
    "# Binary gate disagreement report",
    "",
    `- Gold rows: ${gold.length}`,
    `- Pi example rows: ${examples.length}`,
    `- Binary rows: ${binary.length}`,
    `- Exact binary conflicts: ${exactConflicts.length}`,
    `- Near gold/opposite conflicts @ ${args.threshold}: ${nearConflicts.length}`,
    "",
    "## Top near conflicts",
    "",
    "| Similarity | Gold label | Other label/source | Gold text | Other text |",
    "|---:|---|---|---|---|",
    ...nearConflicts.slice(0, Math.min(args.limit, 30)).map((item) => `| ${item.similarity.toFixed(3)} | ${item.gold.binary}/${item.gold.sourceLabel || ""} | ${item.other.binary}/${item.other.source}:${item.other.sourceLabel || ""} | ${truncate(item.gold.text).replace(/\|/g, "\\|")} | ${truncate(item.other.text).replace(/\|/g, "\\|")} |`),
    "",
    "## Training implication",
    "",
    report.implication,
    "",
  ].join("\n");
  fs.writeFileSync(args.markdown, md, "utf8");

  console.log(`gold: ${gold.length}`);
  console.log(`examples: ${examples.length}`);
  console.log(`binary: ${binary.length}`);
  console.log(`exact conflicts: ${exactConflicts.length}`);
  console.log(`near gold/opposite conflicts: ${nearConflicts.length}`);
  console.log(`report: ${args.report}`);
  console.log(`markdown: ${args.markdown}`);
}

try { main(); } catch (error) { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; }
