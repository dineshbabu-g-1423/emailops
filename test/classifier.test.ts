import { describe, it, expect } from "vitest";
import { diagnoseProvider, reputationScore } from "../src/engine/classifier.js";
import type { ProviderSignal } from "../src/types/index.js";

const healthy: ProviderSignal = {
  provider: "gmail",
  domain: "x.com",
  ip: "1.1.1.1",
  deliveryRate: 0.985,
  bounceRate: 0.008,
  deferralRate: 0.02,
  complaintRate: 0.0004,
};

describe("classifier", () => {
  it("classifies healthy as normal", () => {
    const d = diagnoseProvider(healthy, {});
    expect(d.status).toBe("NORMAL");
    expect(d.rootCause).toBe("normal");
    expect(d.reputationScore).toBeGreaterThanOrEqual(85);
  });

  it("detects provider throttling from 421 + rate-limit text + deferral spike", () => {
    const d = diagnoseProvider(
      {
        ...healthy,
        provider: "outlook",
        smtpCode: 421,
        response: "4.7.650 Temporarily rate limited",
        deferralRate: 0.21,
        deliveryRate: 0.91,
      },
      {},
    );
    expect(d.rootCause).toBe("provider_throttling");
    expect(d.confidence).toBeGreaterThan(0.9);
    expect(d.status).not.toBe("NORMAL");
  });

  it("detects ip reputation from 5xx block response", () => {
    const d = diagnoseProvider(
      {
        ...healthy,
        smtpCode: 554,
        response: "5.7.1 Service unavailable; Client host blocked using Spamhaus",
        deliveryRate: 0.4,
        deferralRate: 0.1,
      },
      {},
    );
    expect(d.rootCause).toBe("ip_reputation");
  });

  it("detects sender reputation from high complaint rate", () => {
    const d = diagnoseProvider(
      { ...healthy, complaintRate: 0.01, deliveryRate: 0.72 },
      {},
    );
    expect(d.rootCause).toBe("sender_reputation");
  });

  it("detects list quality from high bounce, normal deferral", () => {
    const d = diagnoseProvider(
      { ...healthy, bounceRate: 0.12, deliveryRate: 0.8 },
      {},
    );
    expect(d.rootCause).toBe("list_quality");
  });

  it("reputation score decreases monotonically with complaint rate", () => {
    const low = reputationScore({ ...healthy, complaintRate: 0.001 }, {});
    const high = reputationScore({ ...healthy, complaintRate: 0.02 }, {});
    expect(high).toBeLessThan(low);
  });
});
