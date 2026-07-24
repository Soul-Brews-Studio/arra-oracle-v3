import { loadConfig } from "./config";
import { createDiscordClient } from "./discord-client";

const config = loadConfig();
if (config.anthropicApiKey) {
  process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
}

const client = createDiscordClient(config.alwaysAnswerChannelIds);
await client.login(config.discordBotToken);
