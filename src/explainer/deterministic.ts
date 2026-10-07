import type { Explainer, IncidentReport, ProviderDiagnosis } from "../types/index.js";

/**
 * Built-in, API-free explainer.
 *
 * Renders the already-computed decision into readable prose. It performs NO
 * decision-making of its own — it only narrates `report`. This is the default
 * so the tool works offline with zero configuration, and it doubles as the
 * contract an LLM-backed explainer must satisfy.
 */
export class DeterministicExplainer implements Explainer {
  readonly name = "deterministic";

  explain(report: IncidentReport): string {
    const lines: string[] = [];
    lines.push(report.summary);
    lines.push("");

    const degraded = report.diagnoses.filter((d) => d.status !== "NORMAL");
    for (const d of degraded) {
      lines.push(this.explainProvider(report, d));
    }

    if (degraded.length === 0) {
      lines.push("No action required; continue normal sending and monitoring.");
    }

    return lines.join("\n").trim();
  }

  private explainProvider(report: IncidentReport, d: ProviderDiagnosis): string {
    const plan = report.plans.find((p) => p.provider === d.provider && p.ip === d.ip);
    const cause = d.rootCause.replace(/_/g, " ");
    const supporting = d.evidence
      .filter((e) => e.supportsDegradation)
      .map((e) => e.label.toLowerCase())
      .slice(0, 3)
      .join(", ");

    let out = `${capitalize(d.provider)} is showing ${cause} on ${d.ip} ` +
      `(confidence ${Math.round(d.confidence * 100)}%, reputation ${d.reputationScore}/100). ` +
      `Evidence: ${supporting || "deviation from baseline"}. `;

    if (plan) {
      out += `Recommended action: ${plan.action.replace(/_/g, " ").toLowerCase()}`;
      if (plan.recommendedRateMsgPerSec !== undefined) {
        out += ` to ${plan.recommendedRateMsgPerSec} msg/sec`;
      }
      if (plan.expectedRecovery) out += `; expected recovery ${plan.expectedRecovery}`;
      out += ". ";
      if (plan.prohibited.length > 0) {
        out += `Do not ${plan.prohibited.map((p) => p.action.toLowerCase()).join(", ")} — ` +
          `${plan.prohibited[0]!.reason}`;
      }
    }
    return out.trim();
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
