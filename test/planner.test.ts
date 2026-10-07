import { describe, it, expect } from "vitest";
import { planAction } from "../src/engine/planner.js";
import type { ProviderDiagnosis, ProviderSignal } from "../src/types/index.js";

function diag(partial: Partial<ProviderDiagnosis>): ProviderDiagnosis {
  return {
    provider: "outlook",
    ip: "1.1.1.1",
    domain: "x.com",
    status: "DEGRADED",
    rootCause: "provider_throttling",
    confidence: 0.9,
    evidence: [],
    reputationScore: 60,
    ...partial,
  };
}

const sig = (over: Partial<ProviderSignal> = {}): ProviderSignal => ({
  provider: "outlook",
  domain: "x.com",
  ip: "1.1.1.1",
  deliveryRate: 0.9,
  bounceRate: 0.02,
  deferralRate: 0.2,
  complaintRate: 0.001,
  currentRateMsgPerSec: 100,
  ...over,
});

describe("planner", () => {
  it("throttling => REDUCE_RATE with a reduced rate and prohibits suppress/reroute", () => {
    const plan = planAction(diag({}), sig(), "provider_specific");
    expect(plan.action).toBe("REDUCE_RATE");
    expect(plan.recommendedRateMsgPerSec).toBeLessThan(100);
    const prohibited = plan.prohibited.map((p) => p.action);
    expect(prohibited).toContain("SUPPRESS");
    expect(prohibited).toContain("REROUTE");
  });

  it("ip reputation => REROUTE and prohibits RETRY", () => {
    const plan = planAction(diag({ rootCause: "ip_reputation", reputationScore: 30 }), sig(), "ip_specific");
    expect(plan.action).toBe("REROUTE");
    expect(plan.prohibited.map((p) => p.action)).toContain("RETRY");
  });

  it("sender reputation => SUPPRESS", () => {
    const plan = planAction(diag({ rootCause: "sender_reputation", reputationScore: 25 }), sig(), "sender_wide");
    expect(plan.action).toBe("SUPPRESS");
    expect(plan.blastRadius).toMatch(/sender-wide/i);
  });

  it("normal => NO_ACTION with no prohibitions", () => {
    const plan = planAction(diag({ rootCause: "normal", status: "NORMAL", reputationScore: 95 }), sig(), "none");
    expect(plan.action).toBe("NO_ACTION");
    expect(plan.prohibited).toHaveLength(0);
  });

  it("transient => RETRY", () => {
    const plan = planAction(diag({ rootCause: "transient_network" }), sig(), "provider_specific");
    expect(plan.action).toBe("RETRY");
  });
});
