export interface Config {
  discordBotToken: string;
  anthropicApiKey?: string;
  alwaysAnswerChannelIds: string[];
  dbPath: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): Config {
  return {
    discordBotToken: requireEnv("DISCORD_BOT_TOKEN"),
    // Anthropic SDK also resolves credentials via ANTHROPIC_AUTH_TOKEN or an
    // `ant auth login` profile, so this is intentionally optional here.
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    alwaysAnswerChannelIds: (process.env.DISCORD_COURSE_CHANNEL_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
    dbPath: process.env.DISCORD_BOT_DB_PATH ?? "./data/discord-bot.sqlite",
  };
}
