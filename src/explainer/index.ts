export * from "./deterministic.js";
export * from "./llm.js";
import { DeterministicExplainer } from "./deterministic.js";
import type { Explainer } from "../types/index.js";

/** Resolves the default explainer (API-free). */
export function defaultExplainer(): Explainer {
  return new DeterministicExplainer();
}
