#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { LABELS, type Label } from "./routing-heuristics.js";

const DEFAULT_DIR = path.join(process.cwd(), "data", "routing");
const DEFAULT_QUEUE = path.join(DEFAULT_DIR, "label-queue.jsonl");
const DEFAULT_OUTPUT = path.join(DEFAULT_DIR, "gold.jsonl");

const VALID = new Set<string>([...LABELS, "drop"]);

interface QueueRow {
  id: string;
  text: string;
  goldLabel?: "" | Label | "drop";
  heuristicLabel?: Label;
  heuristicConfidence?: number;
  heuristicReason?: string;
  source?: "heuristic" | "ambiguous";
  priority?: number;
  reviewReason?: string;
  sessionFile?: string;
  sessionId?: string;
  cwd?: string;
  turnIndex?: number;
  messageId?: string;
  createdAt?: string;
}

interface GoldRow {
  id: string;
  text: string;
  label: Label;
  source: "gold";
  heuristicLabel?: Label;
  heuristicConfidence?: number;
  heuristicReason?: string;
  queueSource?: "heuristic" | "ambiguous";
  sessionFile?: string;
  sessionId?: string;
  cwd?: string;
  turnIndex?: number;
  messageId?: string;
  createdAt?: string;
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return {
    input: String(args.input || DEFAULT_QUEUE),
    output: String(args.output || DEFAULT_OUTPUT),
    minRows: Math.max(0, Number(args["min-rows"] || 120) || 120),
    allowPartial: Boolean(args["allow-partial"]),
  };
}

function readJsonl(file: string): QueueRow[] {
  if (!fs.existsSync(file)) throw new Error(`Missing queue file: ${file}`);
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as QueueRow)
    .filter((row) => typeof row.text === "string" && row.text.trim().length > 0);
}

function toGold(row: QueueRow): GoldRow | undefined {
  if (!row.goldLabel || row.goldLabel === "drop") return undefined;
  return {
    id: row.id,
    text: row.text,
    label: row.goldLabel,
    source: "gold",
    heuristicLabel: row.heuristicLabel,
    heuristicConfidence: row.heuristicConfidence,
    heuristicReason: row.heuristicReason,
    queueSource: row.source,
    sessionFile: row.sessionFile,
    sessionId: row.sessionId,
    cwd: row.cwd,
    turnIndex: row.turnIndex,
    messageId: row.messageId,
    createdAt: row.createdAt,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = readJsonl(args.input);
  const invalid = rows.filter((row) => row.goldLabel && !VALID.has(row.goldLabel));
  if (invalid.length > 0) {
    const preview = invalid.slice(0, 5).map((row) => `${row.id}:${row.goldLabel}`).join(", ");
    throw new Error(`Invalid goldLabel values (${invalid.length}): ${preview}`);
  }

  const blank = rows.filter((row) => !row.goldLabel).length;
  const dropped = rows.filter((row) => row.goldLabel === "drop").length;
  const gold = rows.map(toGold).filter((row): row is GoldRow => Boolean(row));

  if (!args.allowPartial && gold.length < args.minRows) {
    throw new Error(`Only ${gold.length} labeled rows; need at least ${args.minRows}. Use --allow-partial for progress checks.`);
  }

  const counts = gold.reduce<Record<string, number>>((acc, row) => {
    acc[row.label] = (acc[row.label] || 0) + 1;
    return acc;
  }, {});

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, gold.map((row) => `${JSON.stringify(row)}\n`).join(""), "utf8");

  console.log(`queue rows: ${rows.length}`);
  console.log(`gold rows: ${gold.length}`);
  console.log(`blank rows: ${blank}`);
  console.log(`dropped rows: ${dropped}`);
  console.log(`label counts: ${JSON.stringify(counts)}`);
  console.log(`gold file: ${args.output}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
