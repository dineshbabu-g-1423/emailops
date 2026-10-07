import type {
  IncidentInput,
  IncidentReport,
  ProviderDiagnosis,
  Severity,
} from "../types/index.js";
import { normalizeIncident } from "./normalize.js";
import { diagnoseProvider } from "./classifier.js";
import { planAction } from "./planner.js";

export * from "./normalize.js";
export * from "./classifier.js";
export * from "./planner.js";
export * from "./stats.js";

const SEVERITY_ORDER: Severity[] = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

/**
 * Determines whether degradation is isolated to specific providers/IPs or
 * affects the sender globally. This is the cross-provider reasoning that lets
 * the engine conclude "provider-specific throttling" vs "sender-wide
 * reputation degradation".
 */
function determineScope(
  diagnoses: ProviderDiagnosis[],
): IncidentReport["scope"] {
  const degraded = diagnoses.filter((d) => d.status !== "NORMAL");
  if (degraded.length === 0) return "none";

  const total = diagnoses.length;
  const degradedProviders = new Set(degraded.map((d) => d.provider));
  const degradedIps = new Set(degraded.map((d) => d.ip));

  // Reputation-type causes across most providers => sender-wide. This wins over
  // IP-specific because recipient-complaint signals follow the sender, not the IP.
  const reputationCauses = degraded.filter(
    (d) =>
      d.rootCause === "sender_reputation" ||
      d.rootCause === "list_quality" ||
      d.rootCause === "ip_reputation",
  );
  if (degradedProviders.size >= Math.max(2, Math.ceil(total / 2)) && reputationCauses.length >= degraded.length) {
    return "sender_wide";
  }

  // Single IP across providers degraded (non-reputation) => IP-specific.
  if (degradedIps.size === 1 && degradedProviders.size >= 2) return "ip_specific";

  // Otherwise degradation is confined to specific providers.
  if (degradedProviders.size < total) return "provider_specific";

  return "sender_wide";
}

function buildSummary(
  scope: IncidentReport["scope"],
  diagnoses: ProviderDiagnosis[],
): string {
  const degraded = diagnoses.filter((d) => d.status !== "NORMAL");
  const normal = diagnoses.filter((d) => d.status === "NORMAL");

  if (degraded.length === 0) {
    return "All monitored providers are delivering within healthy baselines.";
  }

  const degradedList = degraded.map((d) => d.provider).join(", ");
  const normalList = normal.map((d) => d.provider).join(", ") || "none";

  switch (scope) {
    case "provider_specific":
      return `Degradation is isolated to ${degradedList} while ${normalList} remain normal — likely provider-specific throttling rather than sender-wide reputation degradation.`;
    case "ip_specific":
      return `A single IP is degraded across multiple providers — the problem is IP-specific (reputation or configuration), not provider-wide.`;
    case "sender_wide":
      return `Degradation spans ${degradedList} with reputation-type signals — likely sender-wide reputation degradation, not a single provider's throttling.`;
    default:
      return `Degradation detected on ${degradedList}.`;
  }
}

/**
 * The single public entry point. Runs the full deterministic pipeline and
 * returns a structured incident report. No side effects, no model calls.
 */
export function analyzeIncident(input: IncidentInput): IncidentReport {
  const normalized = normalizeIncident(input);

  const diagnoses = normalized.signals.map((s) =>
    diagnoseProvider(s, normalized.baselines),
  );

  const scope = determineScope(diagnoses);

  const plans = diagnoses.map((d) => {
    const signal = normalized.signals.find((s) => s.provider === d.provider && s.ip === d.ip);
    return planAction(d, signal, scope);
  });

  const severity = plans.reduce<Severity>(
    (acc, p) => maxSeverity(acc, p.severity),
    "NONE",
  );

  return {
    incidentId: normalized.incidentId!,
    timestamp: normalized.timestamp!,
    severity,
    scope,
    summary: buildSummary(scope, diagnoses),
    diagnoses,
    plans,
  };
}
