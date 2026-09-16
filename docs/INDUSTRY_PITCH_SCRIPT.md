# AEGIS — Industry review script

**Use this as the single source of spoken truth.** Same words for the industry call, SIH, and any teammate who has to intro the product. Do not invent a second story.

**How to read this on a call:** put this file on a second screen or a second window. Read only the lines under **SAY**. Do the lines under **DO**. Do not read the grey coaching notes out loud.

**Default length:** 12 minutes of us, then we stop talking and let them lead.  
**If they say “just tell me what this is”:** read §0 only (~45 seconds), then jump to demo.

---

## 0. The gunshot — memorize these five sentences

If the call dies, if you are nervous, if they interrupt — this is the product.

1. **What it is.** AEGIS is a Chrome extension that sits between your screen and any AI agent. The name is from Greek: a shield — protector, defender.
2. **What it does.** Before a screenshot leaves the laptop, it redacts faces, passwords, and personal data *on the device*. Only the cleaned picture is allowed to go to a model.
3. **What it helps.** People get the convenience of an AI that can fill forms and click around the web — without handing a raw screenshot of their PAN, salary, or face to a server they will never see.
4. **Where it comes from.** Smart India Hackathon 2026, problem **SIH26171**, given by **ISRO / Department of Space**: build a privacy-preserving vision agent that runs in the browser and sanitizes PII **before any network request**.
5. **The line they should remember.** Every AI browser agent today asks you to trust it with your whole screen. We think you shouldn’t have to.

---

## 1. How the team splits this

One person can read every **SAY** block. If you split, assign these four seats the day before. Do **not** rewrite the words — only who speaks.

| Seat | Who | Owns | Minutes |
|---|---|---|---|
| **Lead** | Whoever opens the call | Welcome, gunshot, close, Q&A traffic | 0:00–0:45 and last 2 min |
| **Story** | Strongest speaker | Problem, ISRO brief, why it isn’t solved | ~3 min |
| **Product** | Strongest engineer | What we built, three layers, honest limits | ~3 min |
| **Demo** | Person sharing Chrome | Clicks + the sentences next to each click | ~5 min |

If you are two people: Lead+Story and Product+Demo.  
If you are one person: you are all four. Ignore the seat labels.

**The demo driver does not ad-lib.** If something breaks, read the fallback in §6. Then keep going.

---

## 2. Thirty minutes before the call

Do this on the machine that will be shared. Full click-path is in [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md).

1. `bash scripts/build-dist.sh`
2. Chrome → `chrome://extensions` → Load unpacked → **`dist/`** (never the repo root)
3. On the AEGIS card: **Allow access to file URLs** = ON
4. Open `eval/test-pages/tp08-kitchen-sink-registration.html`
5. Confirm the sidebar face photo actually renders
6. Open the AEGIS popup once. Wait until the badge says **BlazeFace ready (WASM)**. First time can take up to a minute. Leave the popup open.
7. Paste `eval/fixtures/dummy-profile-ananya.json` → **Save Profile**
8. Turn **Scan human faces** ON
9. Optional but better: `ollama serve` + `cd server && node index.js` + `curl http://localhost:8000/health` shows `"mock": false` and `"upstreamReachable": true`. Pre-warm with one Ollama request.
10. Do one **Privacy scan** yourself. Confirm sanitized preview shows a blurred face and black password fields. Then refresh the TP08 tab so the demo looks clean.

**Share Chrome, not the script window.** Zoom/Meet: share the *window* with TP08 + the popup, not the whole desktop if the script would be visible.

Have this file on your laptop screen. Have TP08 on the shared screen.

---

## 3. The script

Spoken text is written to be read as-is. Short sentences on purpose.

---

### 3.1 Open — 45 seconds

**Seat: Lead**

**DO:** Camera on. TP08 visible but don’t start clicking. Smile. One breath.

**SAY:**

Thank you for making time. We are the team behind AEGIS.

In one sentence: AEGIS is a Chrome extension that redacts your screen on the device, before any AI agent is allowed to see it.

The problem statement is SIH 26171, from ISRO. They asked for a privacy-preserving vision agent in the browser that sanitizes PII before any network request.

We will do three things. First, why this problem is real. Second, what we actually built. Third, a live end-to-end workflow on a scholarship form — the same kind of page where a password, a face, and an Aadhaar field sit next to each other.

Please interrupt us. This is a product review, not a performance.

---

### 3.2 The scene — 90 seconds

**Seat: Story**

**SAY:**

Imagine you ask an AI browser agent to fill a loan form, or a scholarship form.

It works. It reads the page. It types your name, your college, your phone.

To do that “understanding,” it took a screenshot of everything on screen — the password you just typed, the face in the sidebar, the Aadhaar box, the PAN box — and sent that picture to a server you will never see, run by a company you did not choose.

You did not consent to that. You wanted a form filled faster.

That is not a thought experiment. That is how today’s leading agents work. Anthropic Computer Use, OpenAI Operator, Google Mariner — the simple architecture is: photograph the screen, send the photograph to the cloud, decide, click.

Independent reviewers have already called that experience impressive and privacy-concerning. Security researchers have shown these agents can also be tricked by a malicious page into leaking exactly this kind of data.

So the question ISRO put in front of us is not “can AI fill a form.” The question is: can the agent still help you if it is *not allowed* to see the secrets.

---

### 3.3 The problem statement, in their language then ours — 60 seconds

**Seat: Story**

**SAY:**

The official brief, almost word for word, is this:

Participants are required to build a privacy-preserving vision agent which runs on the browser. It shall sanitize sensitive and PII data using DOM tags or any other method, before any network request is made.

Organization: Indian Space Research Organisation. Department of Space. Category: Software. Code: SIH26171.

They also told us how we will be scored, which is unusual and useful:

Twenty-five percent — does the local model understand the screen.  
Twenty percent — PII detection.  
Twenty percent — redaction precision, not over-redacting, not under-redacting.  
Twenty percent — client-side resource use. Lightweight, as the title says.  
Fifteen percent — end-to-end latency.

Our plain-language version of that brief, which is also our product sentence:

AI browser agents need to see your screen to help you. Today that means sending everything, including passwords and personal data, to a cloud server. We built a way for the agent to understand the screen without ever exposing what it does not need to see.

---

### 3.4 Why this was empty, and what we shipped — 2 minutes

**Seat: Product**

**SAY:**

You would think someone already shipped this. They have not.

The big labs send the full frame because the “smart” part — planning, clicking, typing — still needs a large vision-language model. That model does not comfortably live in a laptop tab. So cloud is reasonable for *reasoning*.

What is not reasonable is sending the *secrets* along with the layout.

The closest prior experiment we found was text-only, a BERT filter before ChatGPT. It never became a shipped screen agent. Nobody is doing real-time, on-device, visual plus DOM redaction before the screenshot leaves.

That is the gap. AEGIS is the layer that goes in front of any agent.

Concretely, it is a Chrome Manifest V3 extension.

On every capture we run three detectors *inside the browser*, with no network:

One — the live DOM. Password fields, card fields, autocomplete. Deterministic. If the HTML says this is a password, it is a password.

Two — BlazeFace, a tiny ONNX face model, about four hundred kilobytes, running in WebAssembly. Faces get a Gaussian blur.

Three — hybrid text PII. Regex for structured IDs — Aadhaar, PAN, phone, email, cards — and DistilBERT NER for names, places, organizations.

Then we paint the masks on an offscreen canvas. Black for secrets. Blur for faces and PII text.

Only after that — and only if those gates passed — may a vision model see anything. Even then it sees the sanitized image plus a structural sketch: “a password field exists here.” It does not see the password.

If face redaction or name redaction did not finish, we do not send. Fail closed. We would rather the agent refuse than leak.

The optional brain on our demo laptop is Qwen2.5-VL, local, through a small Node gateway. Chrome cannot talk to Ollama directly — it gets a 403 — so the extension talks to localhost port 8000, and 8000 talks to the model. Still on the machine. Still not a cloud screenshot API.

WASM is the baseline so this works on a judge’s laptop without WebGPU. WebGPU is a speedup, not a requirement.

---

### 3.5 What the user actually does — 45 seconds

**Seat: Product** *(hand off to Demo after this)*

**SAY:**

From the user’s point of view there are four verbs.

Privacy scan — prove the redaction. No server. This is the product even if the AI is offline.

Fill Form — first we match the saved profile and any uploaded document text to the labels on the page, locally. Only leftover empty fields may go to the local model, on a sanitized frame.

Run Agent — same redaction, then a loop of click and type until the task is done or we stop.

Upload a PDF — we extract text in the extension. Aadhaar and PAN patterns are stripped before storage. A remote model is not allowed to see that file. A local model may see the *text*, only if the user ticks consent on that upload.

Idle browsing does not run face detection on other people. Faces only when you scan, run the agent, or hit “scan faces now.”

I am going to hand over to the live page.

---

### 3.6 Live end-to-end workflow — ~5 minutes

**Seat: Demo** *(share Chrome now if you haven’t)*

Talk while you click. Never go silent for more than five seconds. If the first scan is slow, say the waiting line. Do not apologize more than once.

---

#### Beat A — show the unprotected page

**DO:** Full-screen TP08. Scroll once so they see the face photo, password fields, card fields, Aadhaar/PAN, and the yellow “how to use” box.

**SAY:**

This is a fake scholarship registration. Treat it as the loan form from the opening.

On the left: an applicant photo — a real face.  
In the form: passwords, card number, CVV, Aadhaar, PAN, name, college.

If a normal agent screenshots this tab, all of that leaves the device. Watch what AEGIS does instead.

---

#### Beat B — Privacy scan (this is the hero; it must work)

**DO:** Click the extension icon. Confirm badge is ready. **Scan human faces** ON. Click **Privacy scan**.

**SAY, immediately after the click:**

I just asked the extension to capture this tab and run the three detectors locally. There is no model call in this step. Nothing is leaving the laptop.

**If the status sits on loading:**

The first run compiles WebAssembly and loads the NER model in the browser. That can take thirty to ninety seconds on a cold start. That delay is the on-device work. Subsequent scans are much faster.

**When overlays appear:**

These boxes are the detector. Password. Card. Identity fields. The face on the photo.

Now look at the popup — sanitized preview.

This picture is the only picture an AI would be allowed to see. Face blurred. Passwords black. PII masked. The layout is still there — buttons, labels, structure — so an agent can still aim. The secrets are not.

The receipt underneath is the audit: how many faces, how many PII spans, how many password fields. If those numbers are zero when they should not be, we block the send. We do not fail open.

That is the product. Everything else is optional convenience on top of this gate.

---

#### Beat C — Fill Form (local first, then agent)

**Only if** profile is saved. **If gateway is down, skip to Beat C-fallback.**

**DO:** Fill tab → **Fill Form**.

**SAY:**

Now the helpful part. We already saved a local profile — Ananya Krishnan, NITK, Bengaluru. It deliberately does *not* contain Aadhaar, PAN, blood group, or emergency contact. Those are traps. A good agent leaves them blank. A leaking agent invents them.

Fill Form first maps profile fields to visible labels on this device. No vision model. Then, only for leftovers, one local-model pass on the sanitized screenshot.

**When fields fill:**

Name, email, phone, address, college — those came from the profile.  
Scroll to Aadhaar, PAN, blood group, portal PIN — those should still be empty. We would rather under-fill than hallucinate an identity number.

That is redaction precision in product form: mask the secret, keep the task, do not invent the secret.

---

#### Beat C-fallback — gateway or Fill Form failed

**SAY:**

The agent hop is down or slow, so I am not going to fight it live.

That is actually the architecture. The privacy layer does not depend on the vision model being up. Scan already proved the thing ISRO asked for: sanitize before any network request. The agent is how you still get work done *after* that gate. We can walk the Fill path after the call if useful.

**DO:** Do not keep retrying. Go to Beat D.

---

#### Beat D — close the loop in one sentence

**SAY:**

End to end: page with secrets, on-device detect, on-device mask, optional local agent on the *cleaned* frame, actions on the live DOM, trap fields left blank.

Raw screenshot never left. That is AEGIS.

---

### 3.7 Who this helps, and what we are not claiming — 90 seconds

**Seat: Product or Lead**

**SAY:**

Who it helps, in order.

One — any person who will use a browser agent on a page that contains their life. Forms, HR portals, hospital dashboards, government KYC.

Two — any enterprise that wants agents and cannot send screenshots of customer data to a US or third-party GPU. Banks, hospitals, government. The blocker is not model quality. The blocker is the screenshot.

Three — the ISRO / Indian data-sovereignty reading of the same idea: reduce what must leave the device. We are not claiming we are an ISRO production system. We are claiming we implemented the architecture they asked student teams to prove.

Honesty, because you are here to help us, not to be sold to.

We do not claim a document “never exists outside the browser” if the user opts into local AI structuring. That text transits localhost on purpose, with consent, and never to a remote Gemini-style endpoint.

We do not claim WebGPU is required. WASM is the path we will demo on someone else’s machine.

We do not claim live Chrome numbers for every SIH metric in this call. The harness and the privacy gates are in code. The scored latency table is still a measurement we owe. If you want the weakest points, they are: first-load wait, small faces in a screenshot, and proving the loop on a machine that is not ours.

---

### 3.8 The ask — 60 seconds

**Seat: Lead**

**SAY:**

We are not asking you to score us like a hackathon judge.

We are asking you to stress-test the product with an industry lens.

Four questions we actually want answers to:

Is “redact the screenshot before the agent” the right wedge, or should we be a form-filler with privacy as a feature?

If you had to cut half of this for a first real user next month, what would you cut?

Who is the first buyer after SIH — a bank security team, a government department, or a consumer extension?

And where does this break in production in ways our test page cannot show?

We will stop there. The rest of the time is yours.

---

### 3.9 Closing line — if they go quiet

**Seat: Lead**

**SAY:**

Every AI browser agent today asks you to trust it with your whole screen. We think you shouldn’t have to. That’s the difference we built. We would like your help making that difference something a real institution would deploy.

Thank you.

---

## 4. If they only give you 3 minutes

Read this and then Privacy-scan only (Beats A and B). No Fill Form.

**SAY:**

AEGIS is a Chrome extension that redacts your screen on the device before any AI agent sees it.

ISRO’s SIH problem 26171 asked for a privacy-preserving browser vision agent that sanitizes PII before any network request. Today’s agents screenshot everything and send it to the cloud. We put a local filter in front of that.

Three detectors in the browser: DOM for passwords, BlazeFace for faces, regex plus NER for PII. Then we mask. Then — and only then — a model may look.

Watch. This is a scholarship form with a face, passwords, and Aadhaar fields.

**DO:** Privacy scan. Point at preview.

**SAY:**

This cleaned picture is what the AI is allowed to see. The raw one never leaves. That is the product. Happy to go deeper on architecture, fill workflow, or limits.

---

## 5. If they only give you 45 seconds

Read §0. Stop. Offer the demo.

---

## 6. Demo breaks — lines, not panic

| What you see | What you say | What you do |
|---|---|---|
| Badge never goes green | The on-device models are still compiling. This is the local runtime, not a server outage. | Wait up to 90s. If dead: Reload extension, refresh TP08, retry once. Then show a pre-captured preview if you have one and narrate. |
| `[NO_CONTENT_SCRIPT]` | The tab needs a refresh after an extension reload. Classic Chrome extension footgun. | Refresh TP08, click scan again. |
| Face count is 0 | Face gate is conservative. We would rather block than send a raw face. The password and PII layers still ran. | Point at black password fields. Do not disable face detection to “make it work” on a recorded call. |
| Fill / Run Agent errors | Local redaction succeeded; the optional brain hop did not. The ISRO requirement is the gate, not the cloud. | Fall back to Beat C-fallback. |
| Popup covers the form | — | Drag or click the page so both preview and form are visible. |
| You loaded the repo root by mistake | Chrome is treating the whole git tree as the extension. That’s a size fail. We load a built `dist` folder instead. | Don’t debug live. Go to Privacy-scan if `dist` is already loaded; otherwise narrate from architecture. |

---

## 7. Likely industry questions — answer bank

Use these words. If you don’t know, say “we have not measured that live yet” — do not guess a number.

**“Isn’t this just a blur extension?”**  
No. Blur-for-screenshots is a filter. AEGIS is a gate in front of an *agent*. The model still has to click and type. We give it structure without secrets, then execute on the real DOM, where the password still exists locally.

**“Why not run the whole agent on device?”**  
The redaction models are small enough for a tab. A general computer-use model is not, not at a quality that fills a messy form. Split: small models for secrets, large model for actions, and the large model is not allowed to see the secrets.

**“Why ISRO?”**  
They posed the problem. The Department of Space cares about systems that do not leak by default. Data that never leaves the device does not have to be trusted to a vendor GPU. We are a student implementation of that architecture, not an ISRO deployment.

**“DPDP / compliance?”**  
We are aligned in spirit: minimize what is processed off-device, consent for the one hop that does happen, never-store for Aadhaar and PAN class identifiers. We are not claiming a legal opinion or a certified control set. We would like your view on how far this language can go with a bank.

**“What model?”**  
On device: BlazeFace and DistilBERT NER, plus regex. For actions in our demo: Qwen2.5-VL 7B via Ollama on the laptop. The extension is model-agnostic behind an OpenAI-compatible endpoint. Swap the brain; keep the gate.

**“Why a Chrome extension?”**  
Because that is where the screenshot and the DOM both exist, which is what the problem statement asked for. It is also where users already install agents.

**“What’s the moat?”**  
Not the particular face model. The moat is the fail-closed pipeline: detect, mask, refuse to send, then act. Anyone can call a VLM. Almost nobody refuses to call it.

**“What would you ship in ninety days?”**  
A boring version: Privacy scan + local fill on three government or bank forms, no hero agent loop, measurement on latency and false redaction, a security review of the vault. We would rather be trusted on ten fields than magical on a hundred.

**“Resource / size?”**  
Judges load `dist/`, about eighty megabytes with the NER model vendored. Loading the git repo would look like over a gigabyte. WASM path is the one we trust on a stranger’s machine.

**“Can it work offline?”**  
Privacy scan: yes, after models are on disk. Fill leftovers / Run Agent: needs the local gateway and Ollama unless we add a purely local fill-only mode — which we already do for fields the profile can match.

**“Idle face scanning / stalking?”**  
Off by design. We do not box every face on every website. Scan on purpose.

---

## 8. Source of truth — copy from here, nowhere else

Use this table when you make slides, a one-pager, a LinkedIn post, or the SIH form. If a sentence is not here, do not add it in a side doc.

| Field | Canonical text |
|---|---|
| Product name | AEGIS |
| One-liner | On-device visual perception for lightweight browser agents — redact the screen before the agent sees it. |
| Category | Chrome extension (Manifest V3) + optional local vision-language model |
| Problem code | SIH26171 |
| Organization | Indian Space Research Organisation (ISRO), Department of Space |
| Official ask | Privacy-preserving vision agent in the browser; sanitize sensitive/PII data (DOM tags or other methods) **before any network request** |
| User problem | Browser agents screenshot the full tab — passwords, faces, IDs — and send that image to the cloud |
| Our solution | Three local detectors (DOM, faces, text PII) → mask on canvas → fail-closed → optional agent on the sanitized frame |
| What we help | Individuals keep agent convenience; enterprises and government can consider agents without shipping raw screens |
| Hero demo | TP08 scholarship page → Privacy scan → sanitized preview + receipt |
| Secondary demo | Fill Form from local profile; trap fields (Aadhaar, PAN, blood group) stay empty |
| Stack, spoken | Chrome extension, ONNX Runtime in WASM, BlazeFace, DistilBERT NER, regex, local Qwen2.5-VL via a Node gateway |
| What never leaves | Raw screenshot, password values, never-store IDs (Aadhaar, PAN, and similar) |
| What may leave | Sanitized image + page structure; uploaded document *text* only to localhost, only with per-upload consent |
| Do not say | “Nothing ever leaves the browser” · “ISRO built this” · “We beat Anthropic” · unverified latency/F1 numbers |
| Remember line | Every AI browser agent today asks you to trust it with your whole screen. We think you shouldn’t have to. |

---

## 9. Timing card (print or pin)

| Clock | Beat | Seat |
|---|---|---|
| 0:00 | Open + gunshot | Lead |
| 0:45 | Loan-form scene + stakes | Story |
| 2:15 | ISRO brief + five weights | Story |
| 3:15 | Architecture, four verbs | Product |
| 5:30 | Live TP08 workflow | Demo |
| 10:30 | Who it helps + honesty | Product / Lead |
| 12:00 | Ask + stop talking | Lead |
| 12:30–end | Their questions | Lead routes; Product answers tech |

If the mentor is enjoying the demo, skip 3.7 and let them drive. The ask still happens before you leave.

---

## 10. Related files

| File | When to open it |
|---|---|
| This file | On the call, second screen |
| [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md) | Prep and recovery codes |
| [`02_ARCHITECTURE.md`](02_ARCHITECTURE.md) | If they want a whiteboard after |
| [`PRIVACY_DOC_UPLOAD.md`](PRIVACY_DOC_UPLOAD.md) | If they push on document upload |
| [`../README.md`](../README.md) | Send them this after the call |
