# Voice Agent — Rough Plan (V1 Scoping)

Status: draft, planning only, no implementation yet.
Owner persona: Nadia Kowalski, `.claude/agents/engineering/voice-agent-engineer.md`.
Sibling example of a self-contained sub-project in this monorepo: `web-shop/` (Astro app at repo root).

## Goal

A person opens the web app (or a dedicated page) and clicks "Call" to start a live, spoken
conversation with an AI agent — no dial-in phone number for V1. The agent answers questions,
walks through a scripted topic, or helps with a task, entirely by voice, with no text fallback
required mid-call. Recommendation: **browser-based call, not a phone number**, because a browser
call needs no telephony provisioning, no PSTN account, and lets us iterate on the pipeline behind
a feature flag before committing to carrier costs and a public phone number's support burden.

## V1 Scope: WebRTC (browser), not SIP/PSTN

- **Channel: WebRTC in-browser call** via a "Call" button in the web app (likely `web/` or a new
  route). Reason: fastest to prototype, no telephony vendor/number provisioning, browser mic/speaker
  access is a solved problem, and it's testable entirely by the engineer with no external phone line.
- SIP/PSTN (a real dial-in number) is a distinct, deferred V2+ channel — different latency profile,
  different interruption/jitter handling, and its own vendor integration (Twilio/Telnyx/etc.).

## Explicitly Out of Scope for V1

- Phone number / PSTN / SIP trunking of any kind.
- Multi-language support (V1 is one language, likely English).
- Outbound calling (agent calls the person) — V1 is inbound/user-initiated only.
- Human handoff / warm transfer to a live agent (V2 concern — see open questions).
- Multi-party calls (V1 is strictly one human + one agent).
- Persistent voice memory/personalization across calls (separate from this pipeline's scope).
- Mobile native app integration (V1 targets desktop/mobile web browser only).

## Core Pipeline Components

1. **VAD (voice activity detection)** — detects when the person starts/stops speaking so the
   pipeline knows when to start streaming to STT and when a turn has ended. Runs client-side or
   at the edge of ingestion to avoid shipping silence.
2. **Streaming STT** — transcribes speech to text incrementally (partial + final transcripts),
   not batch-after-silence, so the LLM can start reasoning before the person finishes talking.
3. **LLM turn-taking / response step** — decides when to respond (on VAD end-of-turn + STT final),
   generates a reply. This is also where **barge-in / interruption handling** sits: if VAD detects
   new speech while TTS is playing, the pipeline must cancel/duck the current TTS output and route
   the new input back to STT — interruption handling is a cross-cutting concern touching VAD, the
   LLM step (abort in-flight generation), and TTS (stop playback), not an isolated component.
4. **Streaming TTS** — synthesizes the LLM's response to audio incrementally (sentence-by-sentence
   or token-stream-to-audio) so playback starts before the full reply is generated.

Pipeline shape: `mic → VAD → streaming STT → LLM (turn-taking + barge-in abort) → streaming TTS → speaker`,
with a feedback loop from VAD back into the LLM/TTS stage for interruptions.

## Latency Budget

**Target: ~1.5s round-trip** (person stops talking → agent's audio starts playing back), matching
the persona's own "~1-2s or it doesn't feel conversational" bar. This constrains the design:
- No slow multi-step agent chains (tool calls, multi-hop retrieval, long deliberation) can happen
  synchronously mid-turn — anything beyond ~1s of processing needs a spoken filler ("let me check
  on that...") while work continues in the background, or must be deferred to V2.
- Rules out large/slow LLMs for the primary conversational turn unless paired with speculative/
  streaming generation; favors smaller or highly-optimized models for the hot path.
- STT and TTS must both be streaming-first, not request/response, since either alone can burn the
  whole budget if done as a single blocking call.

## Build vs Buy

- **Hosted voice-agent platform** (e.g. Vapi, Retell, Bland, or similar all-in-one voice orchestration):
  ships fastest, handles VAD/STT/TTS/turn-taking/interruption plumbing out of the box. Trade-off:
  less control over latency tuning and per-component swaps, ongoing per-minute vendor cost, and
  another external dependency in a repo that otherwise self-hosts (Bun/SQLite/Drizzle).
- **Hand-assembled pipeline** (own WebRTC signaling + a streaming STT API + an LLM + a streaming
  TTS API, wired together): more control over latency and cost at scale, fits the repo's existing
  "self-hosted where reasonable" posture. Trade-off: significantly more integration work up front
  (four services to glue together correctly, especially barge-in) before the first working demo.

Recommendation for the first spike: evaluate one hosted platform against a hand-rolled OpenAI
Realtime-style (or equivalent) pipeline side by side on the same scripted scenario, and pick based
on measured latency + how much the hosted option actually saves versus its cost/lock-in.

## Runtime Note (re: CLAUDE.md Bun preference)

CLAUDE.md prefers Bun ≥1.2 for new services. For the pipeline glue/orchestration server, Bun is
fine and preferred. However, for the real-time audio transport itself, don't force Bun-only
choices if a mature WebRTC media-server stack (e.g. something LiveKit/Pion/mediasoup-based, which
lean Node/Go) is meaningfully more production-ready for jitter buffering and audio routing — call
this out explicitly per file/service if it happens, rather than silently deviating from convention.

## Key Open Questions (need a human decision)

- Do we need a real phone number at all for V1, or is browser-only acceptable for the first users?
  (This plan assumes browser-only; confirm before any telephony vendor research starts.)
- On pipeline failure (STT down, LLM error, TTS failure) mid-call: hang up gracefully with a spoken
  apology, retry silently once, or something else? No human handoff exists in V1 — is that acceptable?
- Accessibility requirements beyond "voice-only, no visual UI required" — e.g. captions for the
  hearing-impaired displayed alongside the call, minimum supported browsers/devices?
- Who owns per-minute vendor cost if a hosted platform is chosen, and is there a usage cap for V1?
- Where does call audio (if any) get logged/retained, and for how long — privacy/compliance owner?
- Which route/surface in `web/` (or a new app) hosts the "Call" button — new sub-project like
  `web-shop/`, or a feature inside an existing app?

## First Milestone ("done" for the very first slice)

Can hold **one scripted-topic voice conversation end-to-end in the browser** — click "Call," speak
a question about a fixed topic, hear a spoken response, interrupt once mid-response and have the
agent stop and listen — with round-trip latency at or under the ~1.5s target, measured and logged
for at least 5 consecutive test calls. No production hardening, no auth, no persistence required
yet — just proof the pipeline holds together and the latency budget is achievable.
