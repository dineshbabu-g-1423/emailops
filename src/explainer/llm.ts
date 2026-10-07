import type { Explainer, IncidentReport } from "../types/index.js";

/**
 * Optional LLM-backed explainer.
 *
 * GUARDRAIL CONTRACT: the model is given the already-decided report and asked
 * ONLY to phrase it. The prompt forbids changing the action, scope, or rates.
 * Because the deterministic engine has already chosen the action and emitted an
 * explicit `prohibited` list, no model output can widen the blast radius — the
 * caller acts on `report.plans`, never on the model's text.
 *
 * This adapter is intentionally transport-agnostic: supply any async function
 * that takes a prompt and returns text (OpenAI, Anthropic, local, etc.).
 */
export type CompletionFn = (prompt: string) => Promise<string>;

export class LlmExplainer implements Explainer {
  readonly name = "llm";
  constructor(private readonly complete: CompletionFn) {}

  async explain(report: IncidentReport): Promise<string> {
    const prompt = buildPrompt(report);
    const text = await this.complete(prompt);
    return text.trim();
  }
}

export function buildPrompt(report: IncidentReport): string {
  return [
    "You are an email deliverability operations assistant.",
    "A deterministic engine has ALREADY decided the root cause and action.",
    "Your ONLY job is to explain the decision clearly and concisely for an on-call engineer.",
    "Rules:",
    "- Do NOT change the action, recommended rate, scope, or severity.",
    "- Do NOT suggest any action listed under `prohibited`.",
    "- Base every statement on the provided evidence only.",
    "",
    "Incident (JSON):",
    JSON.stringify(report, null, 2),
    "",
    "Write a 2–4 sentence explanation: what is happening, why, and the single recommended action.",
  ].join("\n");
}
