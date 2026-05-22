#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { LABELS, type Label } from "./routing-heuristics.js";

const DEFAULT_INPUT = path.join(process.cwd(), "data", "routing", "gold.jsonl");
const DEFAULT_MODEL = path.join(process.cwd(), "data", "routing", "routing-model.json");
const DEFAULT_REPORT = path.join(process.cwd(), "data", "routing", "training-report.json");

interface Row {
  id?: string;
  text: string;
  label: Label;
  source?: string;
  labeler?: string;
  modelConfidence?: number;
  modelReason?: string;
  heuristicLabel?: Label;
  heuristicConfidence?: number;
  heuristicReason?: string;
  queueSource?: string;
  sessionFile?: string;
  sessionId?: string;
  cwd?: string;
  turnIndex?: number;
  messageId?: string;
  createdAt?: string;
}

interface Example {
  text: string;
  label: Label;
  id?: string;
  source?: string;
  weight?: number;
}

interface SplitSet {
  train: Example[];
  test: Example[];
}

interface SparseVector {
  indices: number[];
  values: number[];
}

interface Report {
  input: string;
  rows: number;
  train: number;
  test: number;
  silver: number;
  trainGold: number;
  labels: Record<string, number>;
  trainLabels: Record<string, number>;
  testLabels: Record<string, number>;
  majority: { label: string; accuracy: number; correct: number; total: number };
  logistic: {
    accuracy: number;
    macroF1: number;
    weightedF1: number;
    perClass: Record<string, { precision: number; recall: number; f1: number; support: number; predicted: number }>;
    confusion: Array<{ actual: string; predicted: Array<[string, number]> }>;
    bestEpoch: number;
    trainLoss: number;
    valMacroF1: number;
  };
  featureCount: number;
  config: {
    split: number;
    trainFraction: number;
    valFraction: number;
    maxFeatures: number;
    minDf: number;
    epochs: number;
    learningRate: number;
    l2: number;
    wordNgrams: number[];
    charNgrams: number[];
  };
  provenance: string;
}

interface ModelArtifact {
  kind: "routing-logreg-v1";
  labels: string[];
  features: string[];
  idf: number[];
  bias: number[];
  weights: number[][];
  config: Report["config"];
  provenance: string;
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
    input: String(args.input || DEFAULT_INPUT),
    silver: args.silver ? String(args.silver) : "",
    model: String(args.model || DEFAULT_MODEL),
    report: String(args.report || DEFAULT_REPORT),
    split: Math.max(0.1, Math.min(0.9, Number(args.split || 0.8) || 0.8)),
    trainFraction: Math.max(0.5, Math.min(0.95, Number(args["train-fraction"] || 0.9) || 0.9)),
    valFraction: Math.max(0.02, Math.min(0.4, Number(args["val-fraction"] || 0.1) || 0.1)),
    maxFeatures: Math.max(1000, Number(args["max-features"] || 5000) || 5000),
    minDf: Math.max(1, Number(args["min-df"] || 2) || 2),
    epochs: Math.max(1, Number(args.epochs || 40) || 40),
    learningRate: Math.max(0.001, Number(args["learning-rate"] || 0.25) || 0.25),
    l2: Math.max(0, Number(args.l2 || 0.0001) || 0.0001),
    silverWeight: Math.max(0, Math.min(1, Number(args["silver-weight"] || 0.35) || 0.35)),
    seed: Math.floor(Number(args.seed || 42) || 42),
  };
}

function readRows(file: string): Row[] {
  if (!fs.existsSync(file)) throw new Error(`Missing input file: ${file}`);
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Row)
    .filter((row) => typeof row.text === "string" && typeof row.label === "string" && LABELS.includes(row.label as Label)) as Row[];
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
      const gram = toks.slice(i, i + n).join("_");
      inc(counts, `w${n}:${gram}`);
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

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function stratifiedSplit(rows: Example[], split: number, seed: number): SplitSet {
  const grouped = new Map<string, Example[]>();
  for (const row of rows) {
    const key = row.label;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }
  const train: Example[] = [];
  const test: Example[] = [];
  let offset = seed;
  for (const label of LABELS) {
    const items = shuffle(grouped.get(label) || [], offset++);
    if (items.length === 0) continue;
    const testCount = Math.max(1, Math.min(items.length - 1, Math.round(items.length * (1 - split))));
    test.push(...items.slice(0, testCount));
    train.push(...items.slice(testCount));
  }
  return { train: shuffle(train, seed + 1000), test: shuffle(test, seed + 2000) };
}

function stratifiedTrainVal(rows: Example[], trainFraction: number, valFraction: number, seed: number) {
  const grouped = new Map<string, Example[]>();
  for (const row of rows) {
    const key = row.label;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }
  const train: Example[] = [];
  const val: Example[] = [];
  let offset = seed + 10;
  for (const label of LABELS) {
    const items = shuffle(grouped.get(label) || [], offset++);
    if (items.length === 0) continue;
    let valCount = Math.max(1, Math.round(items.length * valFraction));
    if (items.length > 2) valCount = Math.min(valCount, items.length - 1);
    const trainCount = Math.max(1, items.length - valCount);
    train.push(...items.slice(0, trainCount));
    val.push(...items.slice(trainCount));
  }
  return { train: shuffle(train, seed + 3000), val: shuffle(val, seed + 4000) };
}

function buildFeatureSpace(rows: Example[], maxFeatures: number, minDf: number, wordNgrams: number[], charNgrams: number[]) {
  const df = new Map<string, number>();
  const docCounts = rows.map((row) => {
    const counts = extractFeatureCounts(row.text, wordNgrams, charNgrams);
    for (const feature of counts.keys()) inc(df, feature, 1);
    return counts;
  });
  const features = [...df.entries()]
    .filter(([, count]) => count >= minDf)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxFeatures)
    .map(([feature]) => feature);
  const index = new Map<string, number>(features.map((f, i) => [f, i]));
  const idf = features.map((feature) => Math.log((1 + rows.length) / (1 + (df.get(feature) || 0))) + 1);
  const vectors = docCounts.map((counts) => toVector(counts, index, idf));
  return { features, index, idf, vectors };
}

function toVector(counts: Map<string, number>, index: Map<string, number>, idf: number[]): SparseVector {
  const pairs: Array<[number, number]> = [];
  let norm = 0;
  for (const [feature, tf] of counts.entries()) {
    const idx = index.get(feature);
    if (idx === undefined) continue;
    const value = (1 + Math.log(tf)) * idf[idx];
    pairs.push([idx, value]);
    norm += value * value;
  }
  const scale = norm > 0 ? 1 / Math.sqrt(norm) : 1;
  pairs.sort((a, b) => a[0] - b[0]);
  return { indices: pairs.map(([i]) => i), values: pairs.map(([, v]) => v * scale) };
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((v) => v / sum);
}

function predictProbs(vec: SparseVector, weights: number[][], bias: number[]): number[] {
  const scores = bias.slice();
  for (let c = 0; c < weights.length; c++) {
    let score = scores[c];
    const w = weights[c];
    for (let i = 0; i < vec.indices.length; i++) {
      score += w[vec.indices[i]] * vec.values[i];
    }
    scores[c] = score;
  }
  return softmax(scores);
}

function predictClass(vec: SparseVector, weights: number[][], bias: number[]): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let c = 0; c < weights.length; c++) {
    let score = bias[c];
    const w = weights[c];
    for (let i = 0; i < vec.indices.length; i++) {
      score += w[vec.indices[i]] * vec.values[i];
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function classWeights(rows: Example[], labelToIndex: Map<string, number>, sampleWeights: number[] = []): number[] {
  const counts = new Array(labelToIndex.size).fill(0);
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const weight = sampleWeights[i] ?? row.weight ?? 1;
    counts[labelToIndex.get(row.label)!] += weight;
    total += weight;
  }
  return counts.map((count) => count > 0 ? total / (counts.length * count) : 0);
}

function addSampleGrad(weights: number[][], bias: number[], vec: SparseVector, target: number, probs: number[], sampleWeight: number, lr: number, l2: number) {
  for (let c = 0; c < weights.length; c++) {
    const y = c === target ? 1 : 0;
    const err = (probs[c] - y) * sampleWeight;
    bias[c] -= lr * err;
    const w = weights[c];
    for (let i = 0; i < vec.indices.length; i++) {
      const idx = vec.indices[i];
      const x = vec.values[i];
      w[idx] = w[idx] * (1 - lr * l2) - lr * err * x;
    }
  }
}

function crossEntropy(vecs: SparseVector[], labels: number[], weights: number[][], bias: number[], classW: number[], sampleWeights: number[]): number {
  if (vecs.length === 0) return 0;
  let total = 0;
  let denom = 0;
  for (let i = 0; i < vecs.length; i++) {
    const probs = predictProbs(vecs[i], weights, bias);
    const p = Math.max(1e-12, probs[labels[i]]);
    const sw = sampleWeights[i] ?? 1;
    total += -Math.log(p) * (classW[labels[i]] || 1) * sw;
    denom += sw;
  }
  return denom > 0 ? total / denom : 0;
}

function accuracy(actual: number[], predicted: number[]): number {
  if (actual.length === 0) return 0;
  let correct = 0;
  for (let i = 0; i < actual.length; i++) if (actual[i] === predicted[i]) correct++;
  return correct / actual.length;
}

function confusion(actual: number[], predicted: number[], labelCount: number): number[][] {
  const matrix = Array.from({ length: labelCount }, () => new Array(labelCount).fill(0));
  for (let i = 0; i < actual.length; i++) matrix[actual[i]][predicted[i]]++;
  return matrix;
}

function perClassMetrics(matrix: number[][], labels: string[]) {
  const out: Record<string, { precision: number; recall: number; f1: number; support: number; predicted: number }> = {};
  for (let c = 0; c < labels.length; c++) {
    const tp = matrix[c][c] || 0;
    const support = matrix[c].reduce((a, b) => a + b, 0);
    let predicted = 0;
    for (let r = 0; r < matrix.length; r++) predicted += matrix[r][c];
    const precision = predicted > 0 ? tp / predicted : 0;
    const recall = support > 0 ? tp / support : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    out[labels[c]] = { precision, recall, f1, support, predicted };
  }
  return out;
}

function macroF1(metrics: ReturnType<typeof perClassMetrics>): number {
  const values = Object.values(metrics);
  if (values.length === 0) return 0;
  return values.reduce((sum, m) => sum + m.f1, 0) / values.length;
}

function weightedF1(metrics: ReturnType<typeof perClassMetrics>): number {
  const values = Object.values(metrics);
  const total = values.reduce((sum, m) => sum + m.support, 0);
  if (total === 0) return 0;
  return values.reduce((sum, m) => sum + m.f1 * m.support, 0) / total;
}

function majorityLabel(rows: Example[]): string {
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.label] = (acc[row.label] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || LABELS[0];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = readRows(args.input).map((row) => ({ text: row.text, label: row.label, id: row.id, source: row.source, weight: 1 }));
  if (rows.length < 20) throw new Error(`Need more data; found only ${rows.length} rows in ${args.input}`);

  const silverRows = args.silver
    ? readRows(args.silver).map((row) => ({ text: row.text, label: row.label, id: row.id, source: row.source, weight: args.silverWeight }))
    : [];

  const split = stratifiedSplit(rows, args.split, args.seed);
  const trainVal = stratifiedTrainVal(split.train, args.trainFraction, args.valFraction, args.seed);
  const trainExamples = [...trainVal.train, ...silverRows];
  const trainWeights = [...trainVal.train.map(() => 1), ...silverRows.map(() => args.silverWeight)];

  const trainCounts = buildFeatureSpace(trainExamples, args.maxFeatures, args.minDf, [1, 2], [3, 4]);
  const valCounts = trainVal.val.map((row) => toVector(extractFeatureCounts(row.text, [1, 2], [3, 4]), trainCounts.index, trainCounts.idf));
  const testCounts = split.test.map((row) => toVector(extractFeatureCounts(row.text, [1, 2], [3, 4]), trainCounts.index, trainCounts.idf));
  const trainVectors = trainCounts.vectors;

  const labelSet = LABELS.filter((label) => rows.some((row) => row.label === label) || silverRows.some((row) => row.label === label));
  const labelToIndex = new Map(labelSet.map((label, i) => [label, i]));
  const indexToLabel = labelSet;
  const trainY = trainExamples.map((row) => labelToIndex.get(row.label)!);
  const valY = trainVal.val.map((row) => labelToIndex.get(row.label)!);
  const testY = split.test.map((row) => labelToIndex.get(row.label)!);
  const classW = classWeights(trainExamples, labelToIndex, trainWeights);

  const featureCount = trainCounts.features.length;
  const classCount = labelSet.length;
  let weights = Array.from({ length: classCount }, () => new Array<number>(featureCount).fill(0));
  let bias = new Array<number>(classCount).fill(0);
  let bestWeights = weights.map((row) => row.slice());
  let bestBias = bias.slice();
  let bestValF1 = -1;
  let bestEpoch = 0;
  let bestTrainLoss = Infinity;
  const epochOrder = [...Array(trainVectors.length).keys()];

  for (let epoch = 1; epoch <= args.epochs; epoch++) {
    const ordered = shuffle(epochOrder, args.seed + epoch);
    for (const idx of ordered) {
      const vec = trainVectors[idx];
      const y = trainY[idx];
      const probs = predictProbs(vec, weights, bias);
      const sampleWeight = (classW[y] || 1) * (trainWeights[idx] || 1);
      addSampleGrad(weights, bias, vec, y, probs, sampleWeight, args.learningRate / Math.sqrt(epoch), args.l2);
    }

    const valPred = valCounts.map((vec) => predictClass(vec, weights, bias));
    const valMatrix = confusion(valY, valPred, classCount);
    const valMetrics = perClassMetrics(valMatrix, indexToLabel);
    const valF1 = macroF1(valMetrics);
    const trainLoss = crossEntropy(trainVectors, trainY, weights, bias, classW, trainWeights);
    if (valF1 > bestValF1 || (valF1 === bestValF1 && trainLoss < bestTrainLoss)) {
      bestValF1 = valF1;
      bestEpoch = epoch;
      bestTrainLoss = trainLoss;
      bestWeights = weights.map((row) => row.slice());
      bestBias = bias.slice();
    }
  }

  weights = bestWeights;
  bias = bestBias;

  const trainPred = trainCounts.vectors.map((vec) => predictClass(vec, weights, bias));
  const valPred = valCounts.map((vec) => predictClass(vec, weights, bias));
  const testPred = testCounts.map((vec) => predictClass(vec, weights, bias));
  const trainMatrix = confusion(trainY, trainPred, classCount);
  const valMatrix = confusion(valY, valPred, classCount);
  const testMatrix = confusion(testY, testPred, classCount);
  const testMetrics = perClassMetrics(testMatrix, indexToLabel);

  const majority = majorityLabel(split.train);
  const majorityCorrect = split.test.filter((row) => row.label === majority).length;

  const model: ModelArtifact = {
    kind: "routing-logreg-v1",
    labels: indexToLabel,
    features: trainCounts.features,
    idf: trainCounts.idf,
    bias,
    weights,
    config: {
      split: args.split,
      trainFraction: args.trainFraction,
      valFraction: args.valFraction,
      maxFeatures: args.maxFeatures,
      minDf: args.minDf,
      epochs: args.epochs,
      learningRate: args.learningRate,
      l2: args.l2,
      wordNgrams: [1, 2],
      charNgrams: [3, 4],
    },
    provenance: `trained on ${path.relative(process.cwd(), args.input)} with label provenance included in rows`,
  };

  const report: Report = {
    input: args.input,
    rows: rows.length,
    train: trainExamples.length,
    test: split.test.length,
    silver: silverRows.length,
    trainGold: trainVal.train.length,
    labels: rows.reduce<Record<string, number>>((acc, row) => { acc[row.label] = (acc[row.label] || 0) + 1; return acc; }, {}),
    trainLabels: trainExamples.reduce<Record<string, number>>((acc, row) => { acc[row.label] = (acc[row.label] || 0) + 1; return acc; }, {}),
    testLabels: split.test.reduce<Record<string, number>>((acc, row) => { acc[row.label] = (acc[row.label] || 0) + 1; return acc; }, {}),
    majority: {
      label: majority,
      accuracy: split.test.length > 0 ? majorityCorrect / split.test.length : 0,
      correct: majorityCorrect,
      total: split.test.length,
    },
    logistic: {
      accuracy: accuracy(testY, testPred),
      macroF1: macroF1(testMetrics),
      weightedF1: weightedF1(testMetrics),
      perClass: testMetrics,
      confusion: testMatrix.map((row, i) => ({
        actual: indexToLabel[i],
        predicted: row.map((count, j) => [indexToLabel[j], count] as [string, number]).filter(([, count]) => count > 0),
      })),
      bestEpoch,
      trainLoss: bestTrainLoss,
      valMacroF1: bestValF1,
    },
    featureCount,
    config: model.config,
    provenance: model.provenance,
  };

  fs.mkdirSync(path.dirname(args.model), { recursive: true });
  fs.writeFileSync(args.model, `${JSON.stringify(model, null, 2)}\n`, "utf8");
  fs.writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`rows: ${rows.length}`);
  console.log(`train gold/silver/val/test: ${trainVal.train.length}/${silverRows.length}/${trainVal.val.length}/${split.test.length}`);
  console.log(`labels: ${JSON.stringify(report.labels)}`);
  console.log(`majority acc: ${(report.majority.accuracy * 100).toFixed(1)}% (${report.majority.correct}/${report.majority.total})`);
  console.log(`logreg acc: ${(report.logistic.accuracy * 100).toFixed(1)}%`);
  console.log(`logreg macro-F1: ${report.logistic.macroF1.toFixed(3)}`);
  console.log(`logreg weighted-F1: ${report.logistic.weightedF1.toFixed(3)}`);
  console.log(`best epoch: ${report.logistic.bestEpoch}`);
  console.log(`feature count: ${report.featureCount}`);
  if (silverRows.length > 0) console.log(`silver weight: ${args.silverWeight}`);
  console.log(`model: ${args.model}`);
  console.log(`report: ${args.report}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
