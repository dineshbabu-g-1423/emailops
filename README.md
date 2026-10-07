# EmailOps — Email Deliverability Intelligence Engine

> Give it raw delivery signals from Gmail, Outlook, Yahoo — bounce/complaint data and SMTP
> responses — and it determines **what is happening, why, and what to do about it**, with
> hard safety guardrails on the recommended action.

EmailOps turns noisy MTA telemetry into an operator-grade **incident report**: a root-cause
diagnosis, a reputation score, a cross-provider scope conclusion, and a single
guardrail-constrained action — plus a plain-English explanation.

The decision is **100% deterministic**. An optional LLM layer only *rephrases* a decision
that has already been made and can never widen the blast radius. This is "AI with guardrails".

---

## Demo

```bash
emailops analyze examples/incident.json
```

```text
EmailOps Intelligence
────────────────────────────────────────
INCIDENT       INC-2026-0017
Severity       CRITICAL
Scope          provider specific

PROVIDER STATUS
  outlook   CRITICAL  rep 27/100
  gmail     NORMAL    rep 100/100
  yahoo     NORMAL    rep 96/100

OUTLOOK  (203.0.113.10)
  ROOT CAUSE     provider throttling
  CONFIDENCE     94%
  EVIDENCE
    ✗ Deferral rate elevated (7x, z=18)
    ✗ Delivery latency increased (3.1x)
    ✗ SMTP 421 (transient) responses
  BLAST RADIUS   outlook / 203.0.113.10
  ACTION         REDUCE_RATE
  REC. RATE      27 msg/sec  (27% of current)
  RECOVERY       30–60 minutes
  DO NOT
    ✗ suppress — Evidence is throttling, not recipient-level complaints.
    ✗ reroute — Reputation is intact; moving IPs would spread the throttle.
  REASON         Transient throttling isolated to this provider/IP...

EXPLANATION
Degradation is isolated to outlook while gmail, yahoo remain normal — likely
provider-specific throttling rather than sender-wide reputation degradation.
```

The key reasoning move: because **Gmail and Yahoo are normal**, the engine concludes
*provider-specific throttling* rather than *sender-wide reputation degradation*.

---

## Why this exists

A single SMTP `421` tells you almost nothing. Deliverability decisions require correlating
many signals across providers and IPs, then choosing an action that **doesn't make things
worse**. The dangerous failure mode in email ops is over-reacting — suppressing recipients or
rotating an entire IP pool in response to transient throttling. EmailOps encodes those
guardrails explicitly.

| Question it answers | How |
| --- | --- |
| Why are deliveries dropping? | Root-cause classifier |
| Provider problem or our reputation problem? | Cross-provider scope analysis |
| Which IP is causing it? | Per-provider/IP diagnosis |
| Should we throttle or retry? | Deterministic action planner |
| Which destinations are affected? | Blast-radius computation |
| What's the *safest* action? | Explicit `prohibited` action list |

---

## Architecture

```text
              Delivery Signals (SMTP / provider feeds / complaints)
                                │
                                ▼
                     ┌──────────────────┐
                     │ Signal Normalizer │   validate + clamp + baseline
                     └────────┬─────────┘
                              ▼
                     ┌──────────────────┐
                     │ Root-Cause        │   evidence + statistics + hints
                     │ Classifier        │
                     └────────┬─────────┘
                              ▼
                     ┌──────────────────┐
                     │ Reputation Engine │   weighted score 0–100
                     └────────┬─────────┘
                              ▼
                     ┌──────────────────┐
                     │ Action Planner    │   one action + prohibitions
                     └────────┬─────────┘
                              ▼
         ┌──────────┬─────────┼──────────┬──────────┐
     REDUCE_RATE  REROUTE  SUPPRESS    RETRY    ESCALATE
                              │
                              ▼
                     ┌──────────────────┐
                     │ Explainer         │   deterministic (default) or LLM
                     └──────────────────┘
```

Every stage is a pure function. `analyzeIncident(input)` runs the whole pipeline with no I/O
and no model calls.

---

## Install & run

Requires Node 18+.

```bash
npm install
npm run build          # compile to dist/
npm test               # run the full suite

# Run directly without building (via tsx):
npm run analyze -- examples/incident.json
# or the raw structured report:
npm run analyze -- examples/incident.json --json
```

Exit codes: `0` healthy/low, `2` when severity is HIGH/CRITICAL (handy for CI/alerting).

---

## Input contract

```jsonc
{
  "incidentId": "INC-2026-0017",
  "signals": [
    {
      "provider": "outlook",          // gmail | outlook | yahoo | aol | icloud | other
      "domain": "example.com",
      "ip": "203.0.113.10",
      "smtpCode": 421,
      "response": "4.7.650 Temporarily rate limited",
      "deliveryRate": 0.91,           // all rates are fractions in [0,1]
      "bounceRate": 0.04,
      "deferralRate": 0.21,
      "complaintRate": 0.002,
      "latencySeconds": 6.2,          // optional
      "currentRateMsgPerSec": 100     // optional — enables a concrete REC. RATE
    }
  ],
  "baselines": {                       // optional per provider or provider:ip
    "outlook:203.0.113.10": {
      "deferralRate": 0.03,
      "std": { "deferralRate": 0.01 } // enables z-score anomaly detection
    }
  }
}
```

If no baseline is supplied, the engine falls back to sensible absolute thresholds.

---

## How decisions are made (and kept safe)

### 1. Evidence & reputation
Each metric is compared to its baseline to produce a **ratio** and (where `std` is given) a
**z-score**. A weighted, logarithmic penalty model yields a reputation score in `[0, 100]`
that maps to `NORMAL` / `DEGRADED` / `CRITICAL`.

### 2. Root cause
A prioritized rule set picks exactly one cause:

| Cause | Signature |
| --- | --- |
| `sender_reputation` | complaint rate ≥ danger threshold, or complaint-rejection text |
| `ip_reputation` | blocklist/auth text (Spamhaus, 5.7.1…) or `5xx` block |
| `provider_throttling` | rate-limit text / `421` **+** deferral spike |
| `list_quality` | high hard-bounce with normal deferral |
| `transient_network` | deferral spike with no reputation/throttle hint |
| `content_spam_filtering` | degraded with no clear signature (→ escalate) |

### 3. Cross-provider scope
The engine looks across providers to decide whether degradation is
`provider_specific`, `ip_specific`, or `sender_wide`. A high complaint rate on *every*
provider → sender-wide. Degradation on Outlook only while Gmail/Yahoo are fine →
provider-specific.

### 4. Action + guardrails
Each root cause maps to **one** action and an explicit list of **prohibited** actions with
reasons. Example — throttling returns `REDUCE_RATE` and *forbids* `SUPPRESS` and `REROUTE`,
so no downstream consumer (or LLM) can escalate beyond backing off.

---

## The LLM layer (optional, pluggable)

The default `DeterministicExplainer` needs no API key — it narrates the already-computed
report. To use a model, implement the `Explainer` contract or pass a completion function to
`LlmExplainer`:

```ts
import { analyzeIncident } from "./src/engine/index.js";
import { LlmExplainer } from "./src/explainer/llm.js";

const report = analyzeIncident(input);

const explainer = new LlmExplainer(async (prompt) => {
  // call OpenAI / Anthropic / a local model here
  return await myModel.complete(prompt);
});

console.log(await explainer.explain(report));
```

**Guardrail contract:** the prompt hands the model the finished decision and forbids changing
the action, rates, scope, or severity. The caller always acts on `report.plans` — never on the
model's free text.

---

## Programmatic use

```ts
import { analyzeIncident } from "emailops/engine";

const report = analyzeIncident(incidentJson);
for (const plan of report.plans) {
  if (plan.action === "REDUCE_RATE") throttle(plan.provider, plan.recommendedRateMsgPerSec);
}
```

---

## Roadmap

- **V1 — Deterministic rules** ✅
- **V2 — Statistical anomaly detection** ✅ (z-scores vs baseline `std`)
- **V3 — Root-cause correlation** ✅ (cross-provider scope)
- **V4 — Action recommendation** ✅ (planner + guardrails)
- **V5 — LLM explanation** ✅ (pluggable, decision-preserving)
- Next: time-series windows ("what changed in the last 30 minutes"), persistence, and a
  provider-feed ingestion adapter.

---

## Project layout

```text
src/
  types/        shared data contracts
  engine/
    normalize   validation + baselines
    stats       ratio / z-score helpers
    classifier  evidence, reputation, root cause
    planner     action + guardrails
    index       analyzeIncident() pipeline
  explainer/
    deterministic  API-free narrator (default)
    llm            pluggable model adapter
  cli/          terminal entry point + formatter
test/           unit + integration (vitest)
examples/       sample incidents
```

## License

MIT
