import { describe, it, expect } from "vitest";
import { ratio, zScore, pctChange, round } from "../src/engine/stats.js";

describe("stats", () => {
  it("computes ratios with zero-guard", () => {
    expect(ratio(0.2, 0.04)).toBeCloseTo(5);
    expect(ratio(1, 0)).toBe(Infinity);
    expect(ratio(0, 0)).toBe(1);
  });

  it("computes z-scores", () => {
    expect(zScore(0.18, 0.03, 0.03)).toBeCloseTo(5);
    expect(zScore(0.1, 0.1, 0)).toBe(0);
    expect(zScore(0.1, 0.1, undefined)).toBe(0);
  });

  it("formats percent change", () => {
    expect(pctChange(6.2)).toBe("+520%");
    expect(pctChange(0.5)).toBe("-50%");
    expect(pctChange(Infinity)).toBe("+∞%");
  });

  it("rounds", () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(1.9, 0)).toBe(2);
  });
});
