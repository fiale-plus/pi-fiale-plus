#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { LABELS, type Label } from "./routing-heuristics.js";

const DEFAULT_MODEL = path.join(process.cwd(), "data", "routing", "routing-model.json");
const DEFAULT_INPUT = path.join(process.cwd(), "data", "routing", "examples.jsonl");
const DEFAULT_OUTPUT = path.join(process.cwd(), "data", "routing", "silver.jsonl");
const DEFAULT_REPORT = path.join(process.cwd(), "data", "routing", "silver-report.json");

interface ModelArtifact {
  kind: string;
  labels: string[];
  features: string[];
  idf: number[];
  bias: number[];
  weights: number[][];
  config?: Record<string, unknown>;
}

interface SourceRow {
  text: string;
  label: Label;
  confidence?: number;
  confidenceSource?: string;
  reason?: string;
  sessionFile?: string;
  sessionId?: string;
  cwd?: string;
  turnIndex?: number;
  messageId?: string;
  createdAt?: string;
}

interface SilverRow extends SourceRow {
  source: "silver_agree";
  labeler: string;
  modelConfidence: number;
  modelMargin: number;
  modelReason: string;
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
    model: String(args.model || DEFAULT_MODEL),
    input: String(args.input || DEFAULT_INPUT),
    output: String(args.output || DEFAULT_OUTPUT),
    report: String(args.report || DEFAULT_REPORT),
    threshold: Math.max(0, Math.min(1, Number(args.threshold || 0.5) || 0.5)),
    marginThreshold: Math.max(0, Math.min(1, Number(args["margin-threshold"] || 0.02) || 0.02)),
    labels: String(args.labels || "ops,research,planning,implementation"),
    limit: Math.max(0, Number(args.limit || 0) || 0),
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
  return String(text ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " url ")
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  const norm = normalize(text);
  return norm ? norm.split(" ").filter(Boolean) : [];
}

function inc(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) || 0) + by);
}

function extractFeatureCounts(text: string, wordNgrams: number[], charNgrams: number[]): Map<string, number> {
  const counts = new Map<string, number>();
  const toks = tokens(text);
  const lower = normalize(text);
  for (const n of wordNgrams) {
    if (n <= 0 || toks.length < n) continue;
    for (let i = 0; i <= toks.length - n; i++) {
      inc(counts, `w${n}:${toks.slice(i, i + n).join("_")}`);
    }
  }
  const norm = ` ${lower} `;
  for (const n of charNgrams) {
    if (n <= 0 || norm.length < n) continue;
    for (let i = 0; i <= norm.length - n; i++) {
      const gram = norm.slice(i, i + n);
      if (/^\s+$/.test(gram)) continue;
      inc(counts, `c${n}:${gram}`);
    }
  }

  if (toks.length > 0) inc(counts, `pref1:${toks[0]}`);
  if (toks.length > 1) inc(counts, `pref2:${toks.slice(0, 2).join('_')}`);
  if (toks.length > 2) inc(counts, `pref3:${toks.slice(0, 3).join('_')}`);
  if (text.includes("?")) inc(counts, "cue:question_mark");

  const singleCues = ["check", "why", "what", "how", "should", "status", "stats", "log", "logs", "review", "diff", "pr", "build", "run", "test", "deploy", "fix", "debug", "install", "configure", "plan", "continue", "resume", "compact", "research", "update", "patch", "cleanup", "remove"];
  const multiCues = ["what is", "what's", "safe to use", "pull request", "model family", "how does", "next step", "path forward", "should we", "what should"];
  const tokenSet = new Set(toks);
  for (const cue of singleCues) if (tokenSet.has(cue)) inc(counts, `cue:${cue}`);
  for (const cue of multiCues) if (lower.includes(cue)) inc(counts, `cue:${cue.replace(/\s+/g, '_')}`);
  return counts;
}

function toVector(counts: Map<string, number>, index: Map<string, number>, idf: number[]) {
  const indices: number[] = [];
  const values: number[] = [];
  let norm = 0;
  for (const [feature, tf] of counts.entries()) {
    const idx = index.get(feature);
    if (idx === undefined) continue;
    const value = (1 + Math.log(tf)) * idf[idx];
    indices.push(idx);
    values.push(value);
    norm += value * value;
  }
  const scale = norm > 0 ? 1 / Math.sqrt(norm) : 1;
  for (let i = 0; i < values.length; i++) values[i] *= scale;
  return { indices, values };
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((v) => v / sum);
}

function predict(text: string, model: ModelArtifact) {
  const wordNgrams = Array.isArray(model.config?.wordNgrams) ? (model.config!.wordNgrams as number[]) : [1, 2];
  const charNgrams = Array.isArray(model.config?.charNgrams) ? (model.config!.charNgrams as number[]) : [3, 4];
  const index = new Map(model.features.map((feature, i) => [feature, i]));
  const vec = toVector(extractFeatureCounts(text, wordNgrams, charNgrams), index, model.idf);
  const scores = model.bias.slice();
  for (let c = 0; c < model.weights.length; c++) {
    let score = scores[c];
    const w = model.weights[c];
    for (let i = 0; i < vec.indices.length; i++) {
      score += w[vec.indices[i]] * vec.values[i];
    }
    scores[c] = score;
  }
  const probs = softmax(scores);
  const ranked = probs.map((p, i) => [model.labels[i], p] as [string, number]).sort((a, b) => b[1] - a[1]);
  return {
    label: ranked[0]?.[0] || LABELS[0],
    confidence: ranked[0]?.[1] || 0,
    margin: (ranked[0]?.[1] || 0) - (ranked[1]?.[1] || 0),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const model = JSON.parse(fs.readFileSync(args.model, "utf8")) as ModelArtifact;
  if (model.kind !== "routing-logreg-v1") throw new Error(`Unexpected model kind: ${model.kind}`);
  const allowedLabels = new Set(args.labels.split(",").map((s) => s.trim()).filter(Boolean));
  const rows = readJsonl<SourceRow>(args.input).filter((row) => LABELS.includes(row.label) && (allowedLabels.size === 0 || allowedLabels.has(row.label)));
  const silver: SilverRow[] = [];
  const stats = {
    total: rows.length,
    kept: 0,
    byLabel: {} as Record<string, number>,
    bySourceConfidence: {} as Record<string, number>,
    disagreements: 0,
  };

  for (const row of rows) {
    const pred = predict(row.text, model);
    const agree = pred.label === row.label;
    const strongEnough = pred.confidence >= args.threshold && pred.margin >= args.marginThreshold;
    if (!agree || !strongEnough) continue;
    silver.push({
      ...row,
      source: "silver_agree",
      labeler: "model_agree_v1",
      modelConfidence: pred.confidence,
      modelMargin: pred.margin,
      modelReason: `model agreed with weak label at confidence ${pred.confidence.toFixed(3)} and margin ${pred.margin.toFixed(3)}`,
    });
    stats.kept++;
    stats.byLabel[row.label] = (stats.byLabel[row.label] || 0) + 1;
    const bucket = pred.confidence >= 0.7 ? ">=0.7" : pred.confidence >= 0.6 ? ">=0.6" : ">=0.5";
    stats.bySourceConfidence[bucket] = (stats.bySourceConfidence[bucket] || 0) + 1;
  }

  silver.sort((a, b) => (b.modelConfidence - a.modelConfidence) || (b.modelMargin - a.modelMargin) || (a.label.localeCompare(b.label)));
  if (args.limit > 0) silver.splice(args.limit);

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, silver.map((row) => `${JSON.stringify(row)}\n`).join(""), "utf8");
  fs.writeFileSync(args.report, `${JSON.stringify({ input: args.input, model: args.model, total: stats.total, kept: silver.length, threshold: args.threshold, marginThreshold: args.marginThreshold, labels: args.labels, byLabel: stats.byLabel, byConfidence: stats.bySourceConfidence, sample: silver.slice(0, 12).map((row) => ({ label: row.label, confidence: row.modelConfidence, margin: row.modelMargin, text: row.text.slice(0, 140) })) }, null, 2)}\n`, "utf8");

  console.log(`rows: ${stats.total}`);
  console.log(`kept: ${silver.length}`);
  console.log(`threshold: ${args.threshold}, margin: ${args.marginThreshold}`);
  console.log(`byLabel: ${JSON.stringify(stats.byLabel)}`);
  console.log(`byConfidence: ${JSON.stringify(stats.bySourceConfidence)}`);
  console.log(`output: ${args.output}`);
  console.log(`report: ${args.report}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
