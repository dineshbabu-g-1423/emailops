import { describe, it, expect } from "vitest";
import { analyzeIncident } from "../src/engine/index.js";
import { DeterministicExplainer } from "../src/explainer/deterministic.js";
import { buildPrompt } from "../src/explainer/llm.js";
import incident from "../examples/incident.json";
import senderWide from "../examples/sender-wide-reputation.json";
import type { IncidentInput } from "../src/types/index.js";

describe("analyzeIncident — cross-provider scope", () => {
  it("concludes provider-specific throttling when only Outlook degrades", () => {
    const report = analyzeIncident(incident as IncidentInput);
    expect(report.scope).toBe("provider_specific");
    const outlook = report.diagnoses.find((d) => d.provider === "outlook")!;
    expect(outlook.rootCause).toBe("provider_throttling");
    expect(report.diagnoses.find((d) => d.provider === "gmail")!.status).toBe("NORMAL");
    expect(report.diagnoses.find((d) => d.provider === "yahoo")!.status).toBe("NORMAL");
    expect(report.summary).toMatch(/provider-specific/i);
    const plan = report.plans.find((p) => p.provider === "outlook")!;
    expect(plan.action).toBe("REDUCE_RATE");
    // Rate is throttled in proportion to the reputation score; a 7x deferral
    // spike lands it well below the 100 msg/sec starting point.
    expect(plan.recommendedRateMsgPerSec).toBeLessThan(100);
    expect(plan.recommendedRateMsgPerSec).toBeGreaterThanOrEqual(20);
    expect(plan.prohibited.map((p) => p.action)).toContain("SUPPRESS");
  });

  it("concludes sender-wide reputation when all providers show complaints", () => {
    const report = analyzeIncident(senderWide as IncidentInput);
    expect(report.scope).toBe("sender_wide");
    expect(report.summary).toMatch(/sender-wide/i);
  });
});

describe("explainers", () => {
  it("deterministic explainer narrates the decision without changing it", () => {
    const report = analyzeIncident(incident as IncidentInput);
    const text = new DeterministicExplainer().explain(report);
    expect(text).toMatch(/outlook/i);
    expect(text).toMatch(/throttl/i);
    expect(text.length).toBeGreaterThan(0);
  });

  it("llm prompt embeds guardrails and the full report", () => {
    const report = analyzeIncident(incident as IncidentInput);
    const prompt = buildPrompt(report);
    expect(prompt).toMatch(/Do NOT change the action/);
    expect(prompt).toContain(report.incidentId);
  });
});
