#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import { analyzeIncident } from "../engine/index.js";
import { defaultExplainer } from "../explainer/index.js";
import { formatReport } from "./format.js";
import type { IncidentInput } from "../types/index.js";

const USAGE = `emailops — Email Deliverability Intelligence Engine

Usage:
  emailops analyze <incident.json> [--json] [--no-color]
  emailops --help

Options:
  --json        Emit the raw structured IncidentReport as JSON.
  --no-color    Disable ANSI colors (also honors NO_COLOR env var).
  --help, -h    Show this help.

Reads a JSON incident file (see examples/) and prints a root-cause
diagnosis, guardrail-constrained action plan, and plain-English explanation.
`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
    return args.length === 0 ? 1 : 0;
  }

  if (args.includes("--no-color")) process.env.NO_COLOR = "1";
  const asJson = args.includes("--json");

  const [command, ...rest] = args;
  if (command !== "analyze") {
    process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }

  const file = rest.find((a) => !a.startsWith("--"));
  let raw: string;
  try {
    raw = file ? await readFile(file, "utf8") : await readStdin();
  } catch (err) {
    process.stderr.write(`Failed to read input: ${(err as Error).message}\n`);
    return 1;
  }

  let input: IncidentInput;
  try {
    input = JSON.parse(raw) as IncidentInput;
  } catch (err) {
    process.stderr.write(`Invalid JSON: ${(err as Error).message}\n`);
    return 1;
  }

  let report;
  try {
    report = analyzeIncident(input);
  } catch (err) {
    process.stderr.write(`Analysis error: ${(err as Error).message}\n`);
    return 1;
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return 0;
  }

  const explanation = await defaultExplainer().explain(report);
  process.stdout.write(formatReport(report, explanation) + "\n");
  return report.severity === "HIGH" || report.severity === "CRITICAL" ? 2 : 0;
}

main(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`Fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
