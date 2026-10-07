import type { IncidentReport } from "../types/index.js";

/** ANSI helpers; disabled automatically when not a TTY or NO_COLOR is set. */
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c("1", s);
const dim = (s: string) => c("2", s);
const green = (s: string) => c("32", s);
const yellow = (s: string) => c("33", s);
const red = (s: string) => c("31", s);
const cyan = (s: string) => c("36", s);

function statusColor(status: string): (s: string) => string {
  if (status === "NORMAL" || status === "NONE") return green;
  if (status === "DEGRADED" || status === "MEDIUM" || status === "LOW") return yellow;
  return red;
}

const RULE = "────────────────────────────────────────";

/** Renders the structured report in the pretty CLI layout. */
export function formatReport(report: IncidentReport, explanation: string): string {
  const out: string[] = [];
  out.push(bold("EmailOps Intelligence"));
  out.push(RULE);
  out.push(`${bold("INCIDENT")}       ${report.incidentId}`);
  out.push(`${bold("Severity")}       ${statusColor(report.severity)(report.severity)}`);
  out.push(`${bold("Scope")}          ${report.scope.replace(/_/g, " ")}`);
  out.push(`${bold("Timestamp")}      ${dim(report.timestamp)}`);
  out.push("");

  // Provider status matrix.
  out.push(bold("PROVIDER STATUS"));
  for (const d of report.diagnoses) {
    const pad = d.provider.padEnd(10);
    out.push(`  ${pad}${statusColor(d.status)(d.status.padEnd(10))}${dim(`rep ${d.reputationScore}/100`)}`);
  }
  out.push("");

  // Per-degraded-provider detail.
  for (const d of report.diagnoses.filter((x) => x.status !== "NORMAL")) {
    const plan = report.plans.find((p) => p.provider === d.provider && p.ip === d.ip);
    out.push(bold(`${d.provider.toUpperCase()}  (${d.ip})`));
    out.push(`  ${bold("ROOT CAUSE")}     ${d.rootCause.replace(/_/g, " ")}`);
    out.push(`  ${bold("CONFIDENCE")}     ${Math.round(d.confidence * 100)}%`);
    out.push(`  ${bold("EVIDENCE")}`);
    for (const e of d.evidence) {
      const mark = e.supportsDegradation ? red("✗") : green("✓");
      const detail = e.ratio !== undefined && Number.isFinite(e.ratio)
        ? dim(` (${e.ratio}x${e.zScore ? `, z=${e.zScore}` : ""})`)
        : "";
      out.push(`    ${mark} ${e.label}${detail}`);
    }
    if (plan) {
      out.push(`  ${bold("BLAST RADIUS")}   ${plan.blastRadius}`);
      out.push(`  ${bold("ACTION")}         ${cyan(plan.action)}`);
      if (plan.recommendedRateMsgPerSec !== undefined) {
        out.push(`  ${bold("REC. RATE")}      ${plan.recommendedRateMsgPerSec} msg/sec` +
          (plan.retainFraction ? dim(`  (${Math.round(plan.retainFraction * 100)}% of current)`) : ""));
      }
      if (plan.expectedRecovery) out.push(`  ${bold("RECOVERY")}       ${plan.expectedRecovery}`);
      if (plan.prohibited.length) {
        out.push(`  ${bold("DO NOT")}`);
        for (const p of plan.prohibited) out.push(`    ${red("✗")} ${p.action.toLowerCase()} — ${dim(p.reason)}`);
      }
      out.push(`  ${bold("REASON")}         ${plan.reason}`);
    }
    out.push("");
  }

  out.push(RULE);
  out.push(bold("EXPLANATION"));
  out.push(explanation);
  return out.join("\n");
}
