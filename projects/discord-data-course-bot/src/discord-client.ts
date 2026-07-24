import { Client, Events, GatewayIntentBits, type Message } from "discord.js";
import { answerQuestion } from "./ai";
import {
  appendMessage,
  createThreadRecord,
  getHistory,
  isTrackedThread,
} from "./conversation";
import { debateTopicPrompt, runDebate } from "./debate";
import type { AppDatabase } from "./db/index.ts";
import {
  buildMentionPattern,
  chunkForDiscord,
  deriveThreadName,
  extractQuestion,
  parseDebateTopic,
  shouldRespond,
} from "./message-handler";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDiscordClient(
  db: AppDatabase,
  alwaysAnswerChannelIds: readonly string[],
): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    const botUserId = client.user?.id;
    if (!botUserId) return;

    try {
      if (message.channel.isThread() && isTrackedThread(db, message.channelId)) {
        await continueThread(db, message);
        return;
      }

      const shouldReply = shouldRespond(
        {
          content: message.content,
          channelId: message.channelId,
          authorIsBot: message.author.bot,
          mentionsBot: message.mentions.has(botUserId),
        },
        alwaysAnswerChannelIds,
      );
      if (!shouldReply) return;

      const question = extractQuestion(message.content, buildMentionPattern(botUserId));
      if (!question) return;

      const debateTopic = parseDebateTopic(question);
      if (debateTopic) {
        await startDebateThread(db, message, debateTopic);
        return;
      }

      await startTopicThread(db, message, question);
    } catch (error) {
      console.error("Failed to handle message:", error);
      await message.reply("Something went wrong answering that — try again in a moment.");
    }
  });

  return client;
}

// Opens a new Discord thread for the student's question, so follow-ups on
// that specific topic can happen there without needing another @mention.
async function startTopicThread(
  db: AppDatabase,
  message: Message,
  question: string,
): Promise<void> {
  const thread = await message.startThread({
    name: deriveThreadName(question),
    reason: "Data course Q&A thread",
  });

  createThreadRecord(db, thread.id, message.channelId, question);

  const answer = await answerQuestion(question, []);
  appendMessage(db, thread.id, "user", question);
  appendMessage(db, thread.id, "assistant", answer);

  for (const chunk of chunkForDiscord(answer)) {
    await thread.send(chunk);
  }
}

const DEBATE_TURN_DELAY_MS = 1500;

// Opens a thread where two AI personas (Instructor / Skeptic, see
// src/debate.ts) discuss the topic for students to watch. Every turn is
// persisted as an "assistant" message so students can keep chatting in the
// thread afterward via the normal continueThread flow above.
async function startDebateThread(
  db: AppDatabase,
  message: Message,
  topic: string,
): Promise<void> {
  const thread = await message.startThread({
    name: deriveThreadName(`Debate: ${topic}`),
    reason: "Data course debate thread",
  });

  createThreadRecord(db, thread.id, message.channelId, `Debate: ${topic}`);
  appendMessage(db, thread.id, "user", debateTopicPrompt(topic));

  const transcript = await runDebate(topic);
  for (const turn of transcript) {
    const line = `**${turn.persona}:** ${turn.text}`;
    appendMessage(db, thread.id, "assistant", line);
    for (const chunk of chunkForDiscord(line)) {
      await thread.send(chunk);
    }
    await sleep(DEBATE_TURN_DELAY_MS);
  }
}

// Continues a tracked thread's conversation using its full history so the
// bot stays focused on that thread's specific topic.
async function continueThread(db: AppDatabase, message: Message): Promise<void> {
  const question = message.content.trim();
  if (!question) return;

  const history = getHistory(db, message.channelId);
  const answer = await answerQuestion(question, history);
  appendMessage(db, message.channelId, "user", question);
  appendMessage(db, message.channelId, "assistant", answer);

  for (const chunk of chunkForDiscord(answer)) {
    await message.reply(chunk);
  }
}
