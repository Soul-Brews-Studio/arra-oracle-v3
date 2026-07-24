import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./course";
import type { ConversationTurn } from "./conversation";

// Swap to "claude-haiku-4-5" for lower per-message cost on a high-traffic server,
// or set AI_MODEL in .env to point at a different Anthropic-compatible provider
// (e.g. "GLM-4.7" via z.ai — see .env.example for the ANTHROPIC_BASE_URL /
// ANTHROPIC_AUTH_TOKEN setup; the Anthropic SDK picks those env vars up itself).
const MODEL = process.env.AI_MODEL ?? "claude-opus-4-8";
const MAX_TOKENS = 2048;

// Adaptive thinking + the effort parameter are Claude-specific extensions —
// only send them to actual Claude models, not a compatibility-layer provider
// that may reject unrecognized fields.
const IS_CLAUDE_MODEL = MODEL.toLowerCase().startsWith("claude-");

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

// Lower-level call used by both direct Q&A (answerQuestion) and the debate
// feature (src/debate.ts), which needs its own per-persona system prompt.
export async function generateReply(
  systemPrompt: string,
  messages: ConversationTurn[],
): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    ...(IS_CLAUDE_MODEL
      ? { thinking: { type: "adaptive" as const }, output_config: { effort: "medium" as const } }
      : {}),
    system: systemPrompt,
    messages,
  });

  if (response.stop_reason === "refusal") {
    return "I can't help with that one — it looks like it's outside what I'm able to answer.";
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  return textBlock?.text ?? "I couldn't come up with an answer to that — try rephrasing?";
}

export async function answerQuestion(
  question: string,
  history: ConversationTurn[] = [],
): Promise<string> {
  return generateReply(buildSystemPrompt(), [
    ...history,
    { role: "user", content: question },
  ]);
}
