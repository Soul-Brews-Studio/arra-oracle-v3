import { loadConfig } from "./config";
import { createDatabase } from "./db/index.ts";
import { createDiscordClient } from "./discord-client";

const config = loadConfig();
if (config.anthropicApiKey) {
  process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
}

const { db } = createDatabase(config.dbPath);
const client = createDiscordClient(db, config.alwaysAnswerChannelIds);
await client.login(config.discordBotToken);
