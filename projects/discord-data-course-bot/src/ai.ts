import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./course";
import type { ConversationTurn } from "./conversation";

// Swap to "claude-haiku-4-5" for lower per-message cost on a high-traffic server.
const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 2048;

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export async function answerQuestion(
  question: string,
  history: ConversationTurn[] = [],
): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: buildSystemPrompt(),
    messages: [...history, { role: "user", content: question }],
  });

  if (response.stop_reason === "refusal") {
    return "I can't help with that one — it looks like it's outside what I'm able to answer.";
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  return textBlock?.text ?? "I couldn't come up with an answer to that — try rephrasing?";
}
