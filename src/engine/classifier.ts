import type {
  ProviderSignal,
  Baseline,
  Evidence,
  ProviderDiagnosis,
  RootCause,
  Status,
} from "../types/index.js";
import { DEFAULT_BASELINE, baselineKey } from "./normalize.js";
import { ratio, zScore, round } from "./stats.js";

/** Tunable thresholds for deterministic classification. */
export const THRESHOLDS = {
  deferralRatio: 2.0, // deferrals 2x baseline => elevated
  bounceRatio: 2.5,
  complaintRatio: 3.0,
  latencyRatio: 2.0,
  complaintAbsoluteHigh: 0.003, // 0.3% complaint rate is dangerous anywhere
  bounceAbsoluteHigh: 0.08, // 8% bounces indicates list quality
  zScoreElevated: 3.0, // statistical anomaly threshold
  degradedScore: 70, // reputation score below this => DEGRADED
  criticalScore: 45, // below this => CRITICAL
} as const;

/** SMTP response families that typically indicate throttling. */
const THROTTLE_HINTS = [
  "rate limit",
  "too many",
  "throttl",
  "try again later",
  "temporarily deferred",
  "4.7.650",
  "4.7.28",
];

/** SMTP response families that indicate reputation/content blocking. */
const REPUTATION_HINTS = [
  "spamhaus",
  "blocklist",
  "blacklist",
  "poor reputation",
  "bad reputation",
  "5.7.1",
  "spf",
  "dkim",
  "dmarc",
  "listed",
];

function resolveBaseline(
  signal: ProviderSignal,
  baselines: Record<string, Baseline> | undefined,
): Baseline {
  const byPair = baselines?.[baselineKey(signal.provider, signal.ip)];
  const byProvider = baselines?.[signal.provider];
  return { ...DEFAULT_BASELINE, ...byProvider, ...byPair };
}

function matchesAny(text: string | undefined, hints: string[]): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return hints.some((h) => t.includes(h));
}

/**
 * Collects evidence by comparing each signal against its baseline.
 * Evidence drives both the reputation score and the root-cause decision.
 */
export function collectEvidence(signal: ProviderSignal, baseline: Baseline): Evidence[] {
  const ev: Evidence[] = [];

  const deferralR = ratio(signal.deferralRate, baseline.deferralRate ?? DEFAULT_BASELINE.deferralRate);
  const bounceR = ratio(signal.bounceRate, baseline.bounceRate ?? DEFAULT_BASELINE.bounceRate);
  const complaintR = ratio(signal.complaintRate, baseline.complaintRate ?? DEFAULT_BASELINE.complaintRate);

  if (deferralR >= THRESHOLDS.deferralRatio) {
    ev.push({
      label: "Deferral rate elevated",
      ratio: round(deferralR),
      zScore: round(zScore(signal.deferralRate, baseline.deferralRate ?? 0, baseline.std?.deferralRate)),
      supportsDegradation: true,
    });
  }
  if (bounceR >= THRESHOLDS.bounceRatio) {
    ev.push({
      label: "Bounce rate elevated",
      ratio: round(bounceR),
      zScore: round(zScore(signal.bounceRate, baseline.bounceRate ?? 0, baseline.std?.bounceRate)),
      supportsDegradation: true,
    });
  }
  if (complaintR >= THRESHOLDS.complaintRatio || signal.complaintRate >= THRESHOLDS.complaintAbsoluteHigh) {
    ev.push({
      label: "Complaint rate elevated",
      ratio: round(complaintR),
      zScore: round(zScore(signal.complaintRate, baseline.complaintRate ?? 0, baseline.std?.complaintRate)),
      supportsDegradation: true,
    });
  }

  if (signal.latencySeconds !== undefined && baseline.latencySeconds) {
    const latR = ratio(signal.latencySeconds, baseline.latencySeconds);
    if (latR >= THRESHOLDS.latencyRatio) {
      ev.push({ label: "Delivery latency increased", ratio: round(latR), supportsDegradation: true });
    }
  }

  if (signal.smtpCode && signal.smtpCode >= 400 && signal.smtpCode < 500) {
    ev.push({ label: `SMTP ${signal.smtpCode} (transient) responses`, supportsDegradation: true });
  }
  if (signal.smtpCode && signal.smtpCode >= 500) {
    ev.push({ label: `SMTP ${signal.smtpCode} (permanent) responses`, supportsDegradation: true });
  }

  // Positive (health-supporting) evidence helps cross-provider scope analysis.
  if (deferralR < THRESHOLDS.deferralRatio && bounceR < THRESHOLDS.bounceRatio) {
    ev.push({ label: "Delivery within normal range", supportsDegradation: false });
  }

  return ev;
}

/**
 * Weighted reputation score in [0, 100]. Starts at 100 and subtracts
 * penalties proportional to how far each metric deviates from baseline.
 */
export function reputationScore(signal: ProviderSignal, baseline: Baseline): number {
  let score = 100;

  const deferralR = ratio(signal.deferralRate, baseline.deferralRate ?? DEFAULT_BASELINE.deferralRate);
  const bounceR = ratio(signal.bounceRate, baseline.bounceRate ?? DEFAULT_BASELINE.bounceRate);
  const complaintR = ratio(signal.complaintRate, baseline.complaintRate ?? DEFAULT_BASELINE.complaintRate);

  // Penalties are logarithmic in the deviation ratio so large transient spikes
  // degrade the score meaningfully without instantly flooring it — throttling
  // should read as "degraded, back off", not "dead". Complaint deviations are
  // gated behind the absolute-danger threshold so a 4x bump from a tiny base
  // (e.g. 0.05% -> 0.2%) does not dominate a genuine throttle signature.
  score -= Math.min(45, Math.max(0, Math.log2(Math.max(1, deferralR)) * 16));
  score -= Math.min(45, Math.max(0, Math.log2(Math.max(1, bounceR)) * 14));
  // An absolutely high bounce rate is a strong list-quality signal on its own.
  if (signal.bounceRate >= THRESHOLDS.bounceAbsoluteHigh) score -= 15;
  if (signal.complaintRate >= THRESHOLDS.complaintAbsoluteHigh) {
    score -= Math.min(45, 20 + Math.max(0, (complaintR - 1) * 10));
  } else {
    score -= Math.min(10, Math.max(0, Math.log2(Math.max(1, complaintR)) * 4));
  }

  if (signal.smtpCode && signal.smtpCode >= 500) score -= 15;

  return round(Math.max(0, Math.min(100, score)), 0);
}

function statusFromScore(score: number): Status {
  if (score < THRESHOLDS.criticalScore) return "CRITICAL";
  if (score < THRESHOLDS.degradedScore) return "DEGRADED";
  return "NORMAL";
}

/**
 * Determines the single most likely root cause from evidence + SMTP hints.
 * Ordering matters: permanent/reputation signals dominate transient ones.
 */
export function classifyRootCause(
  signal: ProviderSignal,
  baseline: Baseline,
  status: Status,
): { rootCause: RootCause; confidence: number } {
  if (status === "NORMAL") return { rootCause: "normal", confidence: 0.95 };

  const deferralR = ratio(signal.deferralRate, baseline.deferralRate ?? DEFAULT_BASELINE.deferralRate);
  const bounceR = ratio(signal.bounceRate, baseline.bounceRate ?? DEFAULT_BASELINE.bounceRate);
  const complaintR = ratio(signal.complaintRate, baseline.complaintRate ?? DEFAULT_BASELINE.complaintRate);

  // 1a. Complaint-driven rejections are SENDER reputation even on a 5xx code.
  //     Requires the complaint rate to be genuinely dangerous (absolute), not
  //     just a small relative bump — a mild complaint uptick during throttling
  //     must not mask the throttle signature.
  const complaintText = matchesAny(signal.response, ["complaint", "spam rate", "high complaint"]);
  if (complaintText || signal.complaintRate >= THRESHOLDS.complaintAbsoluteHigh) {
    return { rootCause: "sender_reputation", confidence: complaintText ? 0.9 : 0.85 };
  }

  // 1b. Explicit IP blocklist/auth block signals => IP reputation.
  if (matchesAny(signal.response, REPUTATION_HINTS) || (signal.smtpCode ?? 0) >= 550) {
    const conf = matchesAny(signal.response, REPUTATION_HINTS) ? 0.9 : 0.78;
    return { rootCause: "ip_reputation", confidence: conf };
  }

  // 2. Explicit throttling signature (rate-limit text or 421 + deferral spike)
  //    takes priority over complaint heuristics: a transient 4xx back-off with
  //    rate-limit wording is throttling even if complaints ticked up slightly.
  const throttleCode = signal.smtpCode === 421 || ((signal.smtpCode ?? 0) >= 400 && (signal.smtpCode ?? 0) < 500);
  const throttleText = matchesAny(signal.response, THROTTLE_HINTS);
  if ((throttleText || throttleCode) && deferralR >= THRESHOLDS.deferralRatio) {
    const conf = throttleText ? 0.94 : 0.8;
    return { rootCause: "provider_throttling", confidence: conf };
  }

  // 3. High complaint rate => sender reputation / content filtering.
  if (complaintR >= THRESHOLDS.complaintRatio || signal.complaintRate >= THRESHOLDS.complaintAbsoluteHigh) {
    return { rootCause: "sender_reputation", confidence: 0.85 };
  }

  // 4. High bounce rate with normal deferral => list quality.
  if (bounceR >= THRESHOLDS.bounceRatio && deferralR < THRESHOLDS.deferralRatio) {
    return { rootCause: "list_quality", confidence: 0.82 };
  }

  // 5. Deferral spike without hints => likely transient/network.
  if (deferralR >= THRESHOLDS.deferralRatio) {
    return { rootCause: "transient_network", confidence: 0.6 };
  }

  return { rootCause: "content_spam_filtering", confidence: 0.55 };
}

/** Produces a full per-provider diagnosis for one signal. */
export function diagnoseProvider(
  signal: ProviderSignal,
  baselines: Record<string, Baseline> | undefined,
): ProviderDiagnosis {
  const baseline = resolveBaseline(signal, baselines);
  const evidence = collectEvidence(signal, baseline);
  const score = reputationScore(signal, baseline);
  const status = statusFromScore(score);
  const { rootCause, confidence } = classifyRootCause(signal, baseline, status);

  return {
    provider: signal.provider,
    ip: signal.ip,
    domain: signal.domain,
    status,
    rootCause,
    confidence,
    evidence,
    reputationScore: score,
  };
}
