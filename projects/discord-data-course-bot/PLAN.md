# Discord Data Course Bot — V1 slice

## Goal

A Discord bot that teaches a data course: students ask questions in a
Discord server, the bot answers grounded in a fixed curriculum outline,
using Claude (`claude-opus-4-8`) as the answering model.

## V1 scope

- Single Discord bot process (discord.js) + a local SQLite DB (Drizzle) for
  per-thread conversation history.
- Curriculum lives as static content in `src/course.ts` — no CMS, no
  per-user progress tracking.
- Topic-focused threads: when the bot is `@mentioned` (anywhere) or a
  message lands in a channel listed in `DISCORD_COURSE_CHANNEL_IDS`, it
  opens a new Discord thread named after the question and answers there.
  Any follow-up message inside that thread continues the same
  conversation — no mention needed — with full turn history replayed to
  Claude so the bot stays on that thread's specific topic.
- Conversation history is persisted (`threads` / `thread_messages` tables),
  so a thread survives a bot restart; the last 20 turns are replayed as
  context per reply.
- Debate mode: `@bot debate: <topic>` opens a thread where two fixed AI
  personas (Instructor / Skeptic, see `src/debate.ts`) discuss the topic for
  a few rounds so students can watch, before the thread reverts to normal
  Q&A for any follow-up messages.
- Provider-agnostic: model, `ANTHROPIC_BASE_URL`, and `ANTHROPIC_AUTH_TOKEN`
  are all read from env, so the same code runs against Anthropic directly or
  an Anthropic-compatible provider (e.g. z.ai's GLM models) with no code
  changes — see `.env.example`.

## Explicitly out of scope for V1

- Per-student progress tracking / quizzes / grading.
- Slash commands (mention-based Q&A only).
- RAG over external documents — the curriculum is small enough to embed
  directly in the system prompt.
- Multi-server (guild) configuration — one bot instance, one curriculum.
- Cross-thread memory — each thread's history is isolated to that thread.

## Key files

- `src/course.ts` — curriculum outline + system prompt builder.
- `src/ai.ts` — Anthropic client wrapper. `generateReply` is the low-level
  call (custom system prompt + messages); `answerQuestion` wraps it for
  normal Q&A.
- `src/debate.ts` — two-persona debate: persona definitions, per-persona
  history builder (`buildDebateHistory`), and the turn-taking loop
  (`runDebate`).
- `src/conversation.ts` — thread/message persistence (tracked-thread check,
  history read/append) on top of `src/db`.
- `src/db/schema.ts` + `src/db/index.ts` — Drizzle SQLite schema and client
  (migrations in `src/db/migrations`, generated via `bun run db:generate`;
  never hand-edit the schema outside Drizzle — see repo `CLAUDE.md`).
- `src/message-handler.ts` — pure decision logic (should this message get a
  reply, thread name derivation, Discord message chunking) — kept separate
  from `discord-client.ts` so it's testable without a live Discord/Anthropic
  connection.
- `src/discord-client.ts` — discord.js wiring: opens a topic thread on first
  mention, continues tracked threads with full history.
- `src/index.ts` — entrypoint.

## Open questions

- Model choice: defaults to `claude-opus-4-8` per the repo's Claude API
  conventions. Swap to `claude-haiku-4-5` in `src/ai.ts` if per-message cost
  matters more than answer quality for a high-traffic course server.
- History cap: last 20 turns per thread (`MAX_HISTORY_TURNS` in
  `src/conversation.ts`). Revisit if threads regularly run longer and start
  losing early context.
