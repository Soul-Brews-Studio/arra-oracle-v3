import { Client, Events, GatewayIntentBits, type Message } from "discord.js";
import { answerQuestion } from "./ai";
import {
  appendMessage,
  createThreadRecord,
  getHistory,
  isTrackedThread,
} from "./conversation";
import type { AppDatabase } from "./db/index.ts";
import {
  buildMentionPattern,
  chunkForDiscord,
  deriveThreadName,
  extractQuestion,
  shouldRespond,
} from "./message-handler";

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
