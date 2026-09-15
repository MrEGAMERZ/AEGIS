# ENGINEERING RULES — AEGIS

**Binding for all engineers, all agents, all decisions.**

---

## The Priority Order

**Working → Measurable → Explainable → Privacy-safe → Lightweight → Demoable.**

In that order. Not reversed.

---

## Rules

### Before implementing anything

**Understand the requirement.**

Read the PS. Read `01_REQUIREMENTS.md`. If you don't understand what you're building and why, stop and ask. Do not start implementing based on a guess.

### Before making a technical claim

**Verify it.**

Do not write "latency ≤500ms" until you have run inference and measured it on a real machine.
Do not write "recall ≥85%" until you have run the model against annotated test cases.
Do not write "privacy-safe" until you have confirmed no raw PII crosses the browser boundary — in code, not in prose.

All metrics in the docs marked as "target" are targets. They become claims only after measurement.

### Before adding a feature

**Justify it against all six of the following:**

1. Does the PS require it?
2. Does it improve the core demo?
3. Does it improve a measurable evaluation criterion?
4. What implementation complexity does it add?
5. Does it increase privacy risk?
6. Can it realistically be completed before demo day?

If it fails any of questions 1–3, it does not get built.

### Before calling something complete

**Test it.**

"Complete" means:
- It runs on a clean machine (not the developer's laptop)
- It handles the failure case (what happens when the model returns nothing? what happens when WebGPU is unavailable?)
- Its output matches the specification (bboxes are in the right coordinate space, masks cover the right regions)
- You have looked at the output (open the sanitized image, verify the mask is on the right place)

### When you find a contradiction

**Stop and report it.**

If your implementation does not match the problem statement, the architecture doc, or a measured result — flag it immediately. Do not paper over it. Do not ship around it silently.

Report format:
```
CONTRADICTION FOUND:
  Spec says:        [what the spec claims]
  Implementation:   [what the code actually does]
  Measured result:  [what was observed]
  Proposed fix:     [what needs to change]
```

### When another engineer or agent proposes a feature

**Challenge it.**

Ask: does this improve our score on the five SIH criteria? Does this increase our demo reliability? Or does it just look impressive?

Impressive is not a SIH criterion. Measurable is.

---

## What We Do Not Do

- We do not claim privacy guarantees the architecture cannot prove
- We do not hard-code demo webpages and call it generalization
- We do not add AI models because they are new or interesting
- We do not cite benchmarks we did not run
- We do not hide failure modes from judges — we document them and explain mitigations
- We do not call a stub implementation "Phase 1 complete"

---

## What a Strong Hackathon Team Knows

**What works.** They have tested it and can show it.

**Why it works.** They can explain the mechanism, not just the result.

**Where it fails.** They have found the edge cases. They have measured the failure rate.

**How it was measured.** The metric comes with a methodology, not an impression.

**Why the trade-off was chosen.** Every decision has a cost. They know the cost and chose it deliberately.

---

## Honesty Protocol for the Demo

When a judge asks a question that reveals a limitation:

**Say the limitation. Explain the mitigation. Explain the trade-off.**

Example of correct behavior:
> "BlazeFace misses faces smaller than ~5% of the viewport. We know this. NER still catches names in text.
> We chose BlazeFace because it is 400KB and runs in 15ms — the trade-off is worth it for this use case."

---

## Enforcement

If two engineers disagree on whether to implement something:

Does it make the system more **Working → Measurable → Explainable → Privacy-safe → Lightweight → Demoable**?

If not, it does not get built.

The Lead Engineer owns enforcement. If the Lead Engineer violates these rules, any team member may call it out by citing this document.

---

*Adopted: 2026-08-26*
*Scope: All engineering work on AEGIS*
*Supersedes: Any implicit assumption that "impressive" is a goal*
