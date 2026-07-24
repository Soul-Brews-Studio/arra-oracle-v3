export interface IncomingMessage {
  content: string;
  channelId: string;
  authorIsBot: boolean;
  mentionsBot: boolean;
}

export function shouldRespond(
  message: IncomingMessage,
  alwaysAnswerChannelIds: readonly string[],
): boolean {
  if (message.authorIsBot) return false;
  if (message.mentionsBot) return true;
  return alwaysAnswerChannelIds.includes(message.channelId);
}

export function buildMentionPattern(botUserId: string): RegExp {
  return new RegExp(`<@!?${botUserId}>`, "g");
}

export function extractQuestion(content: string, mentionPattern: RegExp): string {
  return content.replace(mentionPattern, "").trim();
}

const DISCORD_THREAD_NAME_LIMIT = 100;

// Discord thread names are capped at 100 chars — derive one from the
// opening question so each topic gets a recognizable thread.
export function deriveThreadName(
  question: string,
  limit = DISCORD_THREAD_NAME_LIMIT,
): string {
  const singleLine = question.replace(/\s+/g, " ").trim();
  if (!singleLine) return "Course Q&A";
  if (singleLine.length <= limit) return singleLine;
  return `${singleLine.slice(0, limit - 1)}…`;
}

const DISCORD_MESSAGE_LIMIT = 2000;

// Splits on paragraph/line boundaries where possible so code blocks and
// sentences don't get cut mid-way; falls back to a hard slice if a single
// line exceeds the limit on its own.
export function chunkForDiscord(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (line.length <= limit) {
      current = line;
    } else {
      for (let i = 0; i < line.length; i += limit) {
        chunks.push(line.slice(i, i + limit));
      }
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
