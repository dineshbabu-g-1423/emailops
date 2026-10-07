import { describe, it, expect } from "vitest";
import { normalizeIncident, clamp, baselineKey } from "../src/engine/normalize.js";
import type { IncidentInput } from "../src/types/index.js";

describe("normalize", () => {
  it("clamps rates into [0,1]", () => {
    expect(clamp(1.5)).toBe(1);
    expect(clamp(-0.2)).toBe(0);
    expect(clamp(0.5)).toBe(0.5);
  });

  it("builds baseline keys", () => {
    expect(baselineKey("outlook", "1.2.3.4")).toBe("outlook:1.2.3.4");
    expect(baselineKey("gmail")).toBe("gmail");
  });

  it("rejects empty signals", () => {
    expect(() => normalizeIncident({ signals: [] } as IncidentInput)).toThrow(/non-empty/);
  });

  it("rejects signals missing required fields", () => {
    const bad = { signals: [{ provider: "gmail", ip: "1.1.1.1" }] } as unknown as IncidentInput;
    expect(() => normalizeIncident(bad)).toThrow(/required/);
  });

  it("fills defaults and clamps", () => {
    const out = normalizeIncident({
      signals: [
        {
          provider: "gmail",
          domain: "x.com",
          ip: "1.1.1.1",
          deliveryRate: 1.4,
          bounceRate: 0.01,
          deferralRate: 0.02,
          complaintRate: 0.0,
        },
      ],
    });
    expect(out.signals[0]!.deliveryRate).toBe(1);
    expect(out.incidentId).toMatch(/^INC-/);
    expect(out.timestamp).toBeTruthy();
  });
});
