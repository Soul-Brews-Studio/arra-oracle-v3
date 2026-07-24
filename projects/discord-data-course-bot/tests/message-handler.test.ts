import { describe, expect, it } from "bun:test";
import {
  buildMentionPattern,
  chunkForDiscord,
  extractQuestion,
  shouldRespond,
  type IncomingMessage,
} from "../src/message-handler";

function msg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    content: "hello",
    channelId: "channel-1",
    authorIsBot: false,
    mentionsBot: false,
    ...overrides,
  };
}

describe("shouldRespond", () => {
  it("ignores messages from bots", () => {
    expect(shouldRespond(msg({ authorIsBot: true, mentionsBot: true }), [])).toBe(false);
  });

  it("responds when the bot is mentioned, regardless of channel", () => {
    expect(shouldRespond(msg({ mentionsBot: true, channelId: "anywhere" }), [])).toBe(true);
  });

  it("responds in an always-answer channel without a mention", () => {
    expect(
      shouldRespond(msg({ channelId: "qa-channel" }), ["qa-channel"]),
    ).toBe(true);
  });

  it("ignores a plain message outside always-answer channels", () => {
    expect(shouldRespond(msg({ channelId: "general" }), ["qa-channel"])).toBe(false);
  });
});

describe("extractQuestion", () => {
  it("strips a mention and trims whitespace", () => {
    const pattern = buildMentionPattern("123");
    expect(extractQuestion("<@123> what is overfitting?", pattern)).toBe(
      "what is overfitting?",
    );
  });

  it("also strips the nickname-mention form", () => {
    const pattern = buildMentionPattern("123");
    expect(extractQuestion("<@!123> explain joins", pattern)).toBe("explain joins");
  });

  it("returns the content unchanged when there is no mention", () => {
    const pattern = buildMentionPattern("123");
    expect(extractQuestion("explain joins", pattern)).toBe("explain joins");
  });
});

describe("chunkForDiscord", () => {
  it("returns the text unchanged when under the limit", () => {
    expect(chunkForDiscord("short answer", 2000)).toEqual(["short answer"]);
  });

  it("splits on line boundaries when over the limit", () => {
    const line = "x".repeat(30);
    const text = Array.from({ length: 5 }, () => line).join("\n");
    const chunks = chunkForDiscord(text, 70);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(70);
    }
  });

  it("hard-splits a single line longer than the limit", () => {
    const chunks = chunkForDiscord("y".repeat(25), 10);
    expect(chunks).toEqual(["y".repeat(10), "y".repeat(10), "y".repeat(5)]);
  });
});
