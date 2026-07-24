import { Client, Events, GatewayIntentBits, type Message } from "discord.js";
import { answerQuestion } from "./ai";
import {
  buildMentionPattern,
  chunkForDiscord,
  extractQuestion,
  shouldRespond,
} from "./message-handler";

export function createDiscordClient(alwaysAnswerChannelIds: readonly string[]): Client {
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
    const botUserId = client.user?.id;
    if (!botUserId) return;

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

    try {
      const answer = await answerQuestion(question);
      for (const chunk of chunkForDiscord(answer)) {
        await message.reply(chunk);
      }
    } catch (error) {
      console.error("Failed to answer question:", error);
      await message.reply("Something went wrong answering that — try again in a moment.");
    }
  });

  return client;
}
