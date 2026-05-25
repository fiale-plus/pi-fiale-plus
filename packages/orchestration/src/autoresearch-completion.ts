export const MIN_AUTORESEARCH_CYCLES = 2;

export type ResearchCheckResult = "done" | "continue" | "unknown";

export type ResearchCompletionState = {
  cycles?: number;
};

export function hasResearchCompletionEvidence(text: string): boolean {
  return /\b(npm run|npm test|check|test|eval(?:uation)?|benchmark|metric|measur|release|published|installed|PR #|merged|cycle|log|summary)\b/i.test(text);
}

export function shouldHoldResearchOpen(state: ResearchCompletionState, result: ResearchCheckResult, text: string): string | null {
  if (result !== "done") return null;
  const cycles = state.cycles ?? 0;
  if (cycles < MIN_AUTORESEARCH_CYCLES) {
    return `autoresearch needs at least ${MIN_AUTORESEARCH_CYCLES} cycles before auto-completion; observed ${cycles}`;
  }
  if (!hasResearchCompletionEvidence(text)) {
    return "autoresearch completion needs explicit check/evaluation/metric evidence";
  }
  return null;
}
