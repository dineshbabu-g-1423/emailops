import type {
  ProviderDiagnosis,
  ProviderSignal,
  ActionPlan,
  Action,
  Severity,
} from "../types/index.js";
import { round } from "./stats.js";

/**
 * Deterministic, guardrail-constrained action planner.
 *
 * Maps a (root cause, scope, severity) triple onto exactly one allowed action
 * plus an explicit list of PROHIBITED actions. The prohibitions are what make
 * this "AI with guardrails": even if a downstream model is asked to explain the
 * result, it can never widen the blast radius beyond what the rules permit.
 */

function severityFromScore(score: number): Severity {
  if (score >= 85) return "NONE";
  if (score >= 70) return "LOW";
  if (score >= 55) return "MEDIUM";
  if (score >= 40) return "HIGH";
  return "CRITICAL";
}

function retainFraction(score: number): number {
  // Lower reputation => keep less traffic. Bounded to [0.2, 1].
  const frac = Math.max(0.2, Math.min(1, score / 100));
  return round(frac, 2);
}

export function planAction(
  diagnosis: ProviderDiagnosis,
  signal: ProviderSignal | undefined,
  scope: "provider_specific" | "sender_wide" | "ip_specific" | "none",
): ActionPlan {
  const severity = severityFromScore(diagnosis.reputationScore);
  const base = {
    provider: diagnosis.provider,
    ip: diagnosis.ip,
    severity,
    blastRadius:
      scope === "sender_wide"
        ? "All providers (sender-wide)"
        : `${diagnosis.provider} / ${diagnosis.ip}`,
  };

  const allProhibited: { action: Action; reason: string }[] = [];
  const prohibit = (action: Action, reason: string) => allProhibited.push({ action, reason });

  switch (diagnosis.rootCause) {
    case "normal":
      return {
        ...base,
        action: "NO_ACTION",
        blastRadius: "None",
        prohibited: [],
        reason: "Signals are within healthy baseline ranges.",
      };

    case "provider_throttling": {
      const frac = retainFraction(diagnosis.reputationScore);
      const current = signal?.currentRateMsgPerSec;
      prohibit("SUPPRESS", "Evidence is throttling, not recipient-level complaints.");
      prohibit("REROUTE", "Reputation is intact; moving IPs would spread the throttle, not fix it.");
      return {
        ...base,
        action: "REDUCE_RATE",
        recommendedRateMsgPerSec: current !== undefined ? round(current * frac, 0) : undefined,
        retainFraction: frac,
        expectedRecovery: "30–60 minutes",
        prohibited: allProhibited,
        reason:
          "Transient throttling isolated to this provider/IP. Back off send rate and re-assess; evidence does not indicate reputation failure.",
      };
    }

    case "ip_reputation": {
      prohibit("RETRY", "Permanent block will not clear by retrying; retries worsen reputation.");
      return {
        ...base,
        action: "REROUTE",
        expectedRecovery: "Hours to days (delisting dependent)",
        prohibited: allProhibited,
        reason:
          "IP is blocked/listed by the provider. Route affected traffic through a healthy IP and begin delisting/warm-up.",
      };
    }

    case "sender_reputation": {
      prohibit("RETRY", "Retrying flagged content reinforces the complaint signal.");
      return {
        ...base,
        action: "SUPPRESS",
        expectedRecovery: "Days (reputation rebuild)",
        prohibited: allProhibited,
        reason:
          "Complaint rate is dangerously high. Suppress unengaged/complaining recipients before sending more.",
      };
    }

    case "list_quality": {
      prohibit("REDUCE_RATE", "Rate is not the problem; invalid addresses must be removed.");
      return {
        ...base,
        action: "SUPPRESS",
        expectedRecovery: "After list cleaning",
        prohibited: allProhibited,
        reason:
          "High hard-bounce rate indicates poor list quality. Suppress invalid addresses and verify acquisition sources.",
      };
    }

    case "transient_network": {
      prohibit("SUPPRESS", "No recipient-level signal justifies suppression.");
      prohibit("REROUTE", "No reputation signal justifies an IP change.");
      return {
        ...base,
        action: "RETRY",
        expectedRecovery: "Minutes",
        prohibited: allProhibited,
        reason: "Deferrals without reputation/throttle hints suggest a transient condition. Retry with backoff.",
      };
    }

    case "content_spam_filtering":
    default: {
      prohibit("SUPPRESS", "Cause is content filtering, not recipient complaints.");
      return {
        ...base,
        action: "ESCALATE",
        expectedRecovery: "After content review",
        prohibited: allProhibited,
        reason:
          "Degradation without a clear reputation/throttle signature. Escalate for content and authentication review.",
      };
    }
  }
}
