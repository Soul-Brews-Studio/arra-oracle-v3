# Discord Data Course Bot — V1 slice

## Goal

A Discord bot that teaches a data course: students ask questions in a
Discord server, the bot answers grounded in a fixed curriculum outline,
using Claude (`claude-opus-4-8`) as the answering model.

## V1 scope

- Single Discord bot process (discord.js), no database.
- Curriculum lives as static content in `src/course.ts` — no CMS, no
  per-user progress tracking.
- Bot responds to a message when:
  - the bot is `@mentioned` anywhere, or
  - the message is posted in a channel listed in
    `DISCORD_COURSE_CHANNEL_IDS` (a dedicated Q&A channel).
- One-shot Q&A per message — no multi-turn memory across messages (each
  question is answered independently, using the curriculum as system-prompt
  context). Discord's own message history is the only "memory".

## Explicitly out of scope for V1

- Per-student progress tracking / quizzes / grading.
- Slash commands (mention-based Q&A only).
- RAG over external documents — the curriculum is small enough to embed
  directly in the system prompt.
- Multi-server (guild) configuration — one bot instance, one curriculum.

## Key files

- `src/course.ts` — curriculum outline + system prompt builder.
- `src/ai.ts` — Anthropic client wrapper (`answerQuestion`).
- `src/message-handler.ts` — pure decision logic (should this message get a
  reply, and what's the question text) — kept separate from `discord-client.ts`
  so it's testable without a live Discord/Anthropic connection.
- `src/discord-client.ts` — discord.js wiring; calls `message-handler` + `ai`.
- `src/index.ts` — entrypoint.

## Open questions

- Model choice: defaults to `claude-opus-4-8` per the repo's Claude API
  conventions. Swap to `claude-haiku-4-5` in `src/ai.ts` if per-message cost
  matters more than answer quality for a high-traffic course server.
