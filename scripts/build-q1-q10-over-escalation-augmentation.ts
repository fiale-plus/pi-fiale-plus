#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "routing");
const DEFAULT_INPUT = path.join(DIR, "binary-q1-q10-over-escalation-packet.jsonl");
const DEFAULT_OUTPUT = path.join(DIR, "binary-q1-q10-over-escalation-augmentation.jsonl");
const DEFAULT_MARKDOWN = path.join(DIR, "binary-q1-q10-over-escalation-augmentation.md");
const DEFAULT_REPORT = path.join(DIR, "binary-q1-q10-over-escalation-augmentation-report.json");

type Label = "continue" | "escalate";
type PacketRow = { id: string; sourceId?: string; text: string; label: Label; predictedLabel: Label; policyRule: string; missDirection: string };
type AugRow = { id: string; text: string; label: Label; source: string; sourceId: string; policyRule: string; contrast: "near_continue" | "paired_escalate" };

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { args[key] = next; i++; }
    else args[key] = true;
  }
  return {
    input: String(args.input || DEFAULT_INPUT),
    output: String(args.output || DEFAULT_OUTPUT),
    markdown: String(args.markdown || DEFAULT_MARKDOWN),
    report: String(args.report || DEFAULT_REPORT),
  };
}
function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) throw new Error(`Missing input file: ${file}. Run binary:q1-q10-hard-negatives with --direction continue->escalate first.`);
  return fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as T);
}
function countBy<T>(rows: T[], key: (row: T) => string) {
  return rows.reduce<Record<string, number>>((acc, row) => { const k = key(row); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
}
function compact(text: string, max = 160) {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
function cue(text: string) {
  const t = text.toLowerCase();
  if (/models\.json|json|parse/.test(t)) return "config parse error";
  if (/merge failed|merge/.test(t)) return "merge failure";
  if (/worktree/.test(t)) return "worktree experiment";
  if (/docs|\.env|readme/.test(t)) return "docs/config check";
  if (/portfolio|dashboard|ticker|screener/.test(t)) return "portfolio dashboard report";
  if (/qwen|gemma|mlx|llama|ollama|router|model/.test(t)) return "local model setup";
  if (/error|failed|failure/.test(t)) return "error/debug check";
  if (/autoresearch|experiment/.test(t)) return "bounded autoresearch run";
  return "task";
}
function templates(row: PacketRow, index: number): Array<Omit<AugRow, "id" | "sourceId" | "policyRule">> {
  const c = cue(row.text);
  switch (row.policyRule) {
    case "q8_concrete_error_debug":
      return [
        { label: "continue", contrast: "near_continue", source: "q1_q10_over_escalation_contrastive", text: `Task: debug the ${c}; inspect the log, identify the failing command, patch only the concrete broken file, then run the existing check and report the result.` },
        { label: "escalate", contrast: "paired_escalate", source: "q1_q10_over_escalation_contrastive", text: `Task: the ${c} keeps failing after repeated attempts and the next architecture path is unclear; decide whether to redesign the flow or change strategy before implementation.` },
      ];
    case "q6_specific_mixed_research_impl":
      return [
        { label: "continue", contrast: "near_continue", source: "q1_q10_over_escalation_contrastive", text: `Task: run the specific ${c} in the named repo/worktree, try the suggested implementation, run checks, and summarize measured results.` },
        { label: "escalate", contrast: "paired_escalate", source: "q1_q10_over_escalation_contrastive", text: `Task: compare broad alternatives for ${c}, decide the best strategic direction, and choose what the project should build next.` },
      ];
    case "q10_high_risk_clear_or_readonly":
      return [
        { label: "continue", contrast: "near_continue", source: "q1_q10_over_escalation_contrastive", text: `Task: create a read-only ${c}; use the provided data, calculate/report findings, and do not execute trades, deploy, delete, rotate secrets, or change production state.` },
        { label: "escalate", contrast: "paired_escalate", source: "q1_q10_over_escalation_contrastive", text: `Task: based on the ${c}, decide whether to trade, deploy, delete, rotate secrets, or make a high-impact production change.` },
      ];
    case "q7_concrete_machine_status":
      return [
        { label: "continue", contrast: "near_continue", source: "q1_q10_over_escalation_contrastive", text: `Task: check ${c} status/config, inspect files and commands, make a small fix if obvious, and report exactly what changed.` },
        { label: "escalate", contrast: "paired_escalate", source: "q1_q10_over_escalation_contrastive", text: `Task: decide the long-term ${c} architecture and whether the team should switch models, providers, or deployment strategy.` },
      ];
    case "q1_check_concrete":
      return [
        { label: "continue", contrast: "near_continue", source: "q1_q10_over_escalation_contrastive", text: "Task: check whether the file needs an update or patch; if it is clearly stale, patch that file and run the relevant check." },
        { label: "escalate", contrast: "paired_escalate", source: "q1_q10_over_escalation_contrastive", text: "Task: assess whether the whole subsystem should be redesigned before deciding which files to patch." },
      ];
    case "needs_manual_review":
      return [
        { label: "continue", contrast: "near_continue", source: "q1_q10_over_escalation_contrastive", text: `Task: inspect the ${c} output, identify the concrete failing line or missing action point, and continue with a narrow fix/report.` },
        { label: "escalate", contrast: "paired_escalate", source: "q1_q10_over_escalation_contrastive", text: `Task: the ${c} output is ambiguous and changes the project direction; decide the correct strategy before any implementation.` },
      ];
    default:
      return [
        { label: "continue", contrast: "near_continue", source: "q1_q10_over_escalation_contrastive", text: `Task: continue with the concrete ${c}; inspect, implement the narrow requested fix, run checks, and summarize.` },
        { label: "escalate", contrast: "paired_escalate", source: "q1_q10_over_escalation_contrastive", text: `Task: decide the best strategic direction for ${c} before continuing; compare options and choose the plan.` },
      ];
  }
}
function main() {
  const args = parseArgs(process.argv.slice(2));
  const packet = readJsonl<PacketRow>(args.input).filter((row) => row.label === "continue" && row.predictedLabel === "escalate");
  const rows: AugRow[] = [];
  for (const [index, row] of packet.entries()) {
    for (const [templateIndex, template] of templates(row, index).entries()) {
      rows.push({ id: `oe-${String(index + 1).padStart(3, "0")}-${templateIndex + 1}`, sourceId: row.sourceId || row.id, policyRule: row.policyRule, ...template });
    }
  }
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
  const report = { input: args.input, sourceRows: packet.length, rows: rows.length, labelCounts: countBy(rows, (row) => row.label), ruleCounts: countBy(rows, (row) => row.policyRule), contrastCounts: countBy(rows, (row) => row.contrast) };
  fs.writeFileSync(args.report, JSON.stringify(report, null, 2) + "\n", "utf8");
  const md = [
    "# Q1-Q10 over-escalation contrastive augmentation",
    "",
    "Purpose: teach the model to continue on concrete/read-only/debug tasks while preserving paired escalation boundaries.",
    "",
    `- Source over-escalation misses: ${packet.length}`,
    `- Augmentation rows: ${rows.length}`,
    "",
    "## Counts",
    "",
    ...Object.entries(report.labelCounts).sort().map(([label, count]) => `- ${label}: ${count}`),
    "",
    "## Rows",
    "",
    "| ID | Rule | Label | Contrast | Text |",
    "|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.id} | ${row.policyRule} | ${row.label} | ${row.contrast} | ${compact(row.text).replace(/\|/g, "\\|")} |`),
    "",
  ].join("\n");
  fs.writeFileSync(args.markdown, md, "utf8");
  console.log(`source rows: ${packet.length}`);
  console.log(`augmentation rows: ${rows.length}`);
  console.log(`output: ${args.output}`);
  console.log(`markdown: ${args.markdown}`);
  console.log(`report: ${args.report}`);
}
main();
