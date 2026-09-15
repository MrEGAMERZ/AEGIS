# 🎤 Pitch Storytelling Framework — AEGIS
### On-device Visual Perception for Light-weight Browser Agents

---

## 🎯 The Core Principle

Judges read 50+ problem statements before yours. Most teams open with the tech ("we built a client-side ViT using ONNX Runtime Web..."). By the time they explain *why*, the judge has already mentally filed you as "another AI tool team." **You need to make the judge feel the problem in the first 20 seconds — before you say a single technical word.** Technical depth proves you can build it. Story proves you understood *why it matters*. You need both, in that order.

---

## 📖 The Story Arc (Human First, Tech Second)

### 🪝 Act 1: The Hook — Make it personal, not abstract

Don't open with "AI browser agents lack privacy safeguards." Open with a scene:

> *"Imagine you ask your AI browser agent to help you fill out a loan application. It works beautifully — it reads your screen, understands the form, fills in your name, your salary, your bank account number. But to do that 'understanding,' it just took a screenshot of your entire screen — PAN card number, bank balance, everything — and sent it to a server you'll never see, run by a company you've never met. You didn't consent to that. You just wanted a form filled faster."*

This is not hypothetical — it's literally how today's leading browser agents work. That's your hook: **the convenience you already trust is quietly costing you more privacy than you realize.**

### ⚡ Act 2: Raise the stakes — this isn't paranoia, it's already flagged

> *"This isn't a hypothetical fear. Independent reviewers testing today's most advanced browser agent in 2026 described it as 'impressive and privacy-concerning' — noting you're often left wondering how much of your digital life you've opened up. Security researchers have also shown these agents can be tricked by malicious webpages into leaking exactly this kind of data."*

This tells judges: *we didn't invent this problem to justify our project — it's real, documented, and already worrying the people who test these products for a living.*

### 🕳️ Act 3: Why hasn't anyone fixed it? (Show you understand the landscape)

> *"You'd think someone already solved this. They haven't. Anthropic, OpenAI, Google — every major agentic browser today sends the full screen to the cloud to understand it, because running real AI vision locally, in a browser, fast enough to be useful, is genuinely hard. The one prior attempt we found — an open-source project trying to filter private text before sending it to ChatGPT — never got past an early experiment. Nobody has shipped this for actual screen understanding."*

This single paragraph does a lot of work: it shows competitive research, positions you as filling a real gap (not reinventing something), and sets up your solution as the natural next step, not a random idea.

### 💡 Act 4: The reveal — your solution, in plain language first

> *"So we built the missing layer. Before anything on your screen ever leaves your device, a small AI model — running right there in your browser, using nothing but your own laptop's processor — looks at the screen and blacks out your passwords, blurs faces, masks your personal data. Only what's left — a 'sanitized' version of your screen — ever reaches the cloud. The AI agent still gets smart enough information to help you. You just never hand over what it didn't need to see."*

*Then* go technical — WebGPU, ONNX Runtime, quantized ViT — but only after the judge already understands *what* and *why* in human terms.

### 🎬 Act 5: The demo — prove it, don't just claim it

Structure the live demo as **the same scene from Act 1, resolved**:
> *"Let's go back to that loan form. Watch what happens now."* — then show: password fields blacked out, a face on screen blurred, the sanitized data going to the server, the agent still successfully completing the task.

The demo should visually *answer* the fear you raised in Act 1 — that's what makes the story land, not just the code work.

### 🌍 Act 6: The bigger picture — why this matters beyond your demo

> *"This isn't just a hackathon feature — it's the missing trust layer for an entire category of AI product. Every enterprise currently blocked from adopting AI browser agents because of data-exposure concerns — banks, hospitals, government offices — could adopt this pattern. We're not building a one-off tool. We're proposing the architecture the next generation of browser agents should be built on."*

---

## ⏱️ Suggested Pitch Timeline (typical 7–8 minute SIH slot)

| Time | Beat | Goal |
|---|---|---|
| 0:00–0:45 | 🪝 Hook (Act 1) | Judge feels the problem personally, not abstractly |
| 0:45–1:30 | ⚡ Stakes (Act 2) | Judge realizes this is real and current, not invented |
| 1:30–2:15 | 🕳️ Landscape (Act 3) | Judge sees you did real competitive research |
| 2:15–3:00 | 💡 Solution reveal, plain language (Act 4, part 1) | Judge understands *what* you built before *how* |
| 3:00–4:00 | ⚙️ Technical architecture (Act 4, part 2) | Now go deep — WebGPU/ONNX/ViT, latency-accuracy tradeoff, your five-metric alignment |
| 4:00–6:00 | 🎬 Live demo (Act 5) | Prove it, resolve the opening scene visually |
| 6:00–7:00 | 🌍 Vision/impact (Act 6) | Leave judges thinking about scale, not just your demo |
| 7:00–7:30 | 🎯 Closing line | One sentence they'll remember — see below |

---

## 🎯 A Closing Line Worth Rehearsing

End on something concrete and quotable, not a generic "thank you":

> *"Every AI browser agent today asks you to trust it with your whole screen. We think you shouldn't have to. That's the difference we built."*

---

## 🧭 Translating the Problem Statement Into Plain Language (for slides/voiceover)

If a judge only reads your one-line problem summary, this is what should be on the slide — not the official PS wording:

> **Official PS wording:** *"Participants are required to build a privacy-preserving vision agent which runs on browser... it shall sanitize the sensitive/PII data using DOM tags or any other method, before any network request is made."*

> **Your plain-language version:** *"AI browser agents need to see your screen to help you — but today, that means sending everything, including your passwords and personal data, to a cloud server. We built a way for the agent to understand your screen without ever exposing what it doesn't need to see."*

Put the plain-language version on your title slide. Put the technical framing in your architecture slide, later. **Never make the judge translate jargon into meaning themselves — you do that work for them, upfront.**

---

## ⚠️ The Mistake to Avoid

You flagged it yourself: teams with a *better-told* problem statement often beat teams with a *better-built* solution, in judges' first impressions. The fix isn't to dumb down your technical work — it's **sequencing**. Human stakes first, technical depth second, proof (demo) third. If you open with WebGPU and ONNX Runtime, you've already lost the judges who don't know what those are — and even the ones who do will be evaluating your engineering before they understand why it matters. Earn the "why" first. Everything technical lands harder once they already care.
