/**
 * Core data contracts for the Email Deliverability Intelligence Engine.
 *
 * The pipeline is deterministic end-to-end:
 *   raw signals -> normalization -> root-cause classification ->
 *   reputation scoring -> action planning -> (optional) explanation.
 *
 * No stage mutates the delivery decision based on free-form model output.
 * The LLM / explainer layer only renders an already-computed decision.
 */

export type Provider = "gmail" | "outlook" | "yahoo" | "aol" | "icloud" | "other";

/**
 * A single provider's raw delivery signals for the current observation window.
 * Rates are fractions in [0, 1]. `smtpCode`/`response` describe the most
 * significant recent SMTP exchange for the provider/IP pair.
 */
export interface ProviderSignal {
  provider: Provider;
  domain: string;
  ip: string;
  smtpCode?: number;
  response?: string;
  /** Fraction of attempted messages successfully delivered. */
  deliveryRate: number;
  /** Fraction of attempted messages hard-bounced. */
  bounceRate: number;
  /** Fraction of attempted messages deferred (temp failure / 4xx). */
  deferralRate: number;
  /** Fraction of delivered messages generating a complaint (FBL). */
  complaintRate: number;
  /** Average delivery latency in seconds for this window (optional). */
  latencySeconds?: number;
  /** Current send rate in messages/sec for this provider/IP (optional). */
  currentRateMsgPerSec?: number;
}

/**
 * Historical baseline for a provider/IP under healthy conditions.
 * Used to compute deviations and z-scores. All fields optional; when a
 * baseline is absent the engine falls back to absolute thresholds.
 */
export interface Baseline {
  deliveryRate?: number;
  bounceRate?: number;
  deferralRate?: number;
  complaintRate?: number;
  latencySeconds?: number;
  /** Standard deviations used for z-score anomaly detection. */
  std?: {
    deferralRate?: number;
    bounceRate?: number;
    complaintRate?: number;
    latencySeconds?: number;
  };
}

/** Full incident input: current signals plus optional per-provider baselines. */
export interface IncidentInput {
  incidentId?: string;
  timestamp?: string;
  signals: ProviderSignal[];
  /** Keyed by `${provider}:${ip}` or `${provider}`. */
  baselines?: Record<string, Baseline>;
}

/** A single piece of evidence supporting (or contradicting) a classification. */
export interface Evidence {
  label: string;
  /** Multiplicative change vs baseline, e.g. 6.2 means "+520%". */
  ratio?: number;
  /** Statistical z-score vs baseline where available. */
  zScore?: number;
  /** Whether this evidence supports degradation (true) or health (false). */
  supportsDegradation: boolean;
}

export type RootCause =
  | "provider_throttling"
  | "sender_reputation"
  | "ip_reputation"
  | "content_spam_filtering"
  | "list_quality"
  | "transient_network"
  | "normal";

export type Action =
  | "REDUCE_RATE"
  | "REROUTE"
  | "SUPPRESS"
  | "RETRY"
  | "ESCALATE"
  | "WARM_UP"
  | "NO_ACTION";

export type Severity = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Status = "NORMAL" | "DEGRADED" | "CRITICAL";

/** Per-provider health classification produced by the classifier. */
export interface ProviderDiagnosis {
  provider: Provider;
  ip: string;
  domain: string;
  status: Status;
  rootCause: RootCause;
  confidence: number;
  evidence: Evidence[];
  /** Reputation score in [0, 100]; higher is healthier. */
  reputationScore: number;
}

/** The planned, guardrail-constrained response for a provider diagnosis. */
export interface ActionPlan {
  provider: Provider;
  ip: string;
  action: Action;
  severity: Severity;
  /** Recommended send rate (msg/sec) when action is REDUCE_RATE. */
  recommendedRateMsgPerSec?: number;
  /** Fraction of current traffic to keep when throttling. */
  retainFraction?: number;
  expectedRecovery?: string;
  blastRadius: string;
  /** Explicit "do not do" guardrails, with reasons. */
  prohibited: { action: Action; reason: string }[];
  reason: string;
}

/** The full engine output for an incident. */
export interface IncidentReport {
  incidentId: string;
  timestamp: string;
  severity: Severity;
  /** Cross-provider conclusion: provider-specific vs sender-wide. */
  scope: "provider_specific" | "sender_wide" | "ip_specific" | "none";
  summary: string;
  diagnoses: ProviderDiagnosis[];
  plans: ActionPlan[];
}

/** Contract for any explanation layer (deterministic, LLM-backed, etc.). */
export interface Explainer {
  readonly name: string;
  explain(report: IncidentReport): Promise<string> | string;
}
