import type { ProviderSignal, IncidentInput } from "../types/index.js";

/** Default healthy baselines when no history is supplied. */
export const DEFAULT_BASELINE = {
  deliveryRate: 0.98,
  bounceRate: 0.01,
  deferralRate: 0.03,
  complaintRate: 0.0005,
  latencySeconds: 2,
} as const;

const RATE_FIELDS = [
  "deliveryRate",
  "bounceRate",
  "deferralRate",
  "complaintRate",
] as const;

/** Clamp a number into [min, max]. */
export function clamp(n: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, n));
}

/** Build the baseline lookup key for a provider/IP pair. */
export function baselineKey(provider: string, ip?: string): string {
  return ip ? `${provider}:${ip}` : provider;
}

/**
 * Validates and normalizes raw incident input:
 *  - clamps rate fields into [0, 1]
 *  - coerces missing optional numerics to sane defaults
 *  - throws on structurally invalid input so the CLI can report clearly
 */
export function normalizeIncident(input: IncidentInput): IncidentInput {
  if (!input || !Array.isArray(input.signals) || input.signals.length === 0) {
    throw new Error("Incident input must contain a non-empty `signals` array.");
  }

  const signals: ProviderSignal[] = input.signals.map((raw, idx) => {
    if (!raw.provider) throw new Error(`signals[${idx}] missing \`provider\`.`);
    if (!raw.ip) throw new Error(`signals[${idx}] missing \`ip\`.`);

    const s: ProviderSignal = {
      ...raw,
      domain: raw.domain ?? "unknown",
    };

    for (const f of RATE_FIELDS) {
      const v = s[f];
      if (v === undefined || v === null || Number.isNaN(v)) {
        throw new Error(`signals[${idx}].${f} is required and must be a number.`);
      }
      s[f] = clamp(v);
    }

    if (s.latencySeconds !== undefined) s.latencySeconds = Math.max(0, s.latencySeconds);
    if (s.currentRateMsgPerSec !== undefined) {
      s.currentRateMsgPerSec = Math.max(0, s.currentRateMsgPerSec);
    }
    return s;
  });

  return {
    incidentId: input.incidentId ?? `INC-${Date.now()}`,
    timestamp: input.timestamp ?? new Date().toISOString(),
    signals,
    baselines: input.baselines ?? {},
  };
}
