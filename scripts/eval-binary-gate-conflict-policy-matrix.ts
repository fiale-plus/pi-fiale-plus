#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "routing");
const OUT = path.join(DIR, "binary-conflict-policy-matrix-report.json");
const LABELS = ["continue", "escalate"] as const;
type Bin = typeof LABELS[number];
type Row = { text: string; label: Bin; source: string };
const BIN: Record<string, Bin | undefined> = { planning: "escalate", debugging: "escalate", research: "escalate", review: "escalate", implementation: "continue", ops: "continue", handoff: "continue" };

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l) as T);
}
function norm(text: string) { return text.toLowerCase().replace(/https?:\/\/\S+/g, " url ").replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim(); }
function inc(m: Map<string, number>, k: string, by = 1) { m.set(k, (m.get(k) || 0) + by); }
function counts<T>(rows: T[], f: (row: T) => string) { return rows.reduce<Record<string, number>>((a, r) => { const k = f(r); a[k] = (a[k] || 0) + 1; return a; }, {}); }
function shuffle<T>(items: T[], seed: number) { let s = seed >>> 0; const rnd = () => { s += 0x6D2B79F5; let r = Math.imul(s ^ (s >>> 15), 1 | s); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; const out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }

function conflictKeys(): Set<string> {
  const byText = new Map<string, Array<{ label: Bin; source: string }>>();
  const add = (text: string, label: Bin, source: string) => { const k = norm(text); if (!k) return; const arr = byText.get(k) || []; arr.push({ label, source }); byText.set(k, arr); };
  for (const g of readJsonl<any>(path.join(DIR, "gold.jsonl"))) { const b = BIN[String(g.label)]; if (b && g.text) add(String(g.text), b, "gold"); }
  for (const e of readJsonl<any>(path.join(DIR, "examples.jsonl"))) { const b = BIN[String(e.label)]; if (b && e.text) add(String(e.text), b, "pi_examples"); }
  const out = new Set<string>();
  for (const [k, rows] of byText) {
    const labels = new Set(rows.map(r => r.label));
    const sources = new Set(rows.map(r => r.source));
    if (labels.size > 1 && sources.has("gold") && sources.has("pi_examples")) out.add(k);
  }
  return out;
}

function feats(text: string) {
  const c = new Map<string, number>();
  const toks = norm(text).split(" ").filter(Boolean);
  for (const n of [1, 2]) if (toks.length >= n) for (let i = 0; i <= toks.length - n; i++) inc(c, `w${n}:${toks.slice(i, i + n).join("_")}`);
  if (toks.length) inc(c, `pref1:${toks[0]}`);
  if (toks.length > 1) inc(c, `pref2:${toks.slice(0, 2).join("_")}`);
  if (text.includes("?")) inc(c, "cue:question_mark");
  for (const cue of ["check", "why", "what", "how", "should", "status", "review", "pr", "build", "run", "test", "fix", "debug", "install", "plan", "continue", "research", "update"]) if (toks.includes(cue)) inc(c, `cue:${cue}`);
  return c;
}
function space(rows: Row[]) {
  const df = new Map<string, number>();
  const docs = rows.map(r => { const f = feats(r.text); for (const k of f.keys()) inc(df, k); return f; });
  const features = [...df.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6000).map(([f]) => f);
  const idx = new Map(features.map((f, i) => [f, i]));
  const idf = features.map(f => Math.log((1 + rows.length) / (1 + (df.get(f) || 0))) + 1);
  return { idx, idf, vecs: docs.map(d => vec(d, idx, idf)) };
}
function vec(f: Map<string, number>, idx: Map<string, number>, idf: number[]) { const pairs: Array<[number, number]> = []; let n = 0; for (const [k, tf] of f) { const i = idx.get(k); if (i === undefined) continue; const v = (1 + Math.log(tf)) * idf[i]; pairs.push([i, v]); n += v * v; } const s = n > 0 ? 1 / Math.sqrt(n) : 1; pairs.sort((a, b) => a[0] - b[0]); return { I: pairs.map(([i]) => i), V: pairs.map(([, v]) => v * s) }; }
function softmax(xs: number[]) { const m = Math.max(...xs); const es = xs.map(x => Math.exp(x - m)); const s = es.reduce((a, b) => a + b, 0) || 1; return es.map(e => e / s); }
function probs(v: { I: number[]; V: number[] }, w: number[][], b: number[]) { const s = b.slice(); for (let c = 0; c < 2; c++) for (let i = 0; i < v.I.length; i++) s[c] += w[c][v.I[i]] * v.V[i]; return softmax(s); }
function train(rows: Row[]) { const sp = space(rows); const y = rows.map(r => LABELS.indexOf(r.label)); const w = Array.from({ length: 2 }, () => new Array<number>(sp.idx.size).fill(0)); const b = [0, 0]; const order = [...Array(rows.length).keys()]; for (let ep = 1; ep <= 24; ep++) for (const i of shuffle(order, 42 + ep)) { const p = probs(sp.vecs[i], w, b); for (let c = 0; c < 2; c++) { const err = p[c] - (c === y[i] ? 1 : 0); b[c] -= 0.25 * err; for (let j = 0; j < sp.vecs[i].I.length; j++) w[c][sp.vecs[i].I[j]] = w[c][sp.vecs[i].I[j]] * (1 - 0.25 * 0.0001) - 0.25 * err * sp.vecs[i].V[j]; } } return { idx: sp.idx, idf: sp.idf, w, b }; }
function evalRows(trainRows: Row[], testRows: Row[]) { const m = train(trainRows); const pred = testRows.map(r => { const p = probs(vec(feats(r.text), m.idx, m.idf), m.w, m.b); return LABELS[p[0] >= p[1] ? 0 : 1]; }); const correct = pred.filter((p, i) => p === testRows[i].label).length; const metric = (label: Bin) => { let tp = 0, fp = 0, fn = 0; for (let i = 0; i < testRows.length; i++) { if (testRows[i].label === label && pred[i] === label) tp++; else if (testRows[i].label !== label && pred[i] === label) fp++; else if (testRows[i].label === label && pred[i] !== label) fn++; } const precision = tp + fp ? tp / (tp + fp) : 0; const recall = tp + fn ? tp / (tp + fn) : 0; const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0; return { precision, recall, f1, support: testRows.filter(r => r.label === label).length }; }; const c = metric("continue"), e = metric("escalate"); return { accuracy: correct / testRows.length, macroF1: (c.f1 + e.f1) / 2, continue: c, escalate: e, test: testRows.length, train: trainRows.length }; }
function randomSplit(rows: Row[]) { const groups = new Map<Bin, Row[]>(); for (const r of rows) groups.set(r.label, [...(groups.get(r.label) || []), r]); const trainRows: Row[] = [], testRows: Row[] = []; let seed = 100; for (const g of groups.values()) { const s = shuffle(g, seed++); const n = Math.max(1, Math.round(s.length * 0.2)); testRows.push(...s.slice(0, n)); trainRows.push(...s.slice(n)); } return { trainRows, testRows }; }
function evalPolicy(name: string, rows: Row[], conflicts: Set<string>) {
  const isConflict = (r: Row) => conflicts.has(norm(r.text));
  const all = name === "drop-from-all" ? rows.filter(r => !isConflict(r)) : rows;
  const rs = randomSplit(all);
  const randomTrain = name === "drop-from-train" ? rs.trainRows.filter(r => !isConflict(r)) : rs.trainRows;
  const sourceHoldouts = Object.keys(counts(all, r => r.source)).sort().map(source => {
    const testRows = all.filter(r => r.source === source);
    const baseTrain = all.filter(r => r.source !== source);
    const trainRows = name === "drop-from-train" ? baseTrain.filter(r => !isConflict(r)) : baseTrain;
    if (testRows.length < 20 || trainRows.length < 20 || Object.keys(counts(testRows, r => r.label)).length < 2) return null;
    return { source, ...evalRows(trainRows, testRows) };
  }).filter(Boolean);
  const goldTest = all.filter(r => r.source === "gold");
  const goldTrainBase = all.filter(r => r.source !== "gold");
  const goldTrain = name === "drop-from-train" ? goldTrainBase.filter(r => !isConflict(r)) : goldTrainBase;
  return { policy: name, rows: all.length, removedFromAll: rows.length - all.length, random: evalRows(randomTrain, rs.testRows), goldHoldout: evalRows(goldTrain, goldTest), sourceHoldouts };
}
function main() {
  const rows = readJsonl<any>(path.join(DIR, "binary-gate.jsonl")).map(r => ({ text: String(r.text), label: r.label as Bin, source: String(r.source) }));
  const conflicts = conflictKeys();
  const policies = ["keep", "drop-from-train", "drop-from-all"].map(p => evalPolicy(p, rows, conflicts));
  const report = { input: path.join(DIR, "binary-gate.jsonl"), rows: rows.length, conflictKeys: conflicts.size, sourceCounts: counts(rows, r => r.source), policies };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`rows: ${rows.length}`);
  console.log(`conflict keys: ${conflicts.size}`);
  for (const p of policies) console.log(`${p.policy}: rows=${p.rows} random=${(p.random.accuracy*100).toFixed(1)} gold=${(p.goldHoldout.accuracy*100).toFixed(1)} goldF1=${p.goldHoldout.macroF1.toFixed(3)}`);
  console.log(`report: ${OUT}`);
}
main();
