import { describe, expect, it } from "bun:test";
import {
  buildMentionPattern,
  chunkForDiscord,
  deriveThreadName,
  extractQuestion,
  parseDebateTopic,
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

describe("deriveThreadName", () => {
  it("uses the question as-is when short enough", () => {
    expect(deriveThreadName("what is overfitting?")).toBe("what is overfitting?");
  });

  it("collapses newlines and extra whitespace to single spaces", () => {
    expect(deriveThreadName("what is\n\noverfitting?  ")).toBe("what is overfitting?");
  });

  it("falls back to a default name for an empty question", () => {
    expect(deriveThreadName("   ")).toBe("Course Q&A");
  });

  it("truncates with an ellipsis at the limit", () => {
    const long = "x".repeat(150);
    const name = deriveThreadName(long, 100);
    expect(name.length).toBe(100);
    expect(name.endsWith("…")).toBe(true);
    expect(name.startsWith("x".repeat(99))).toBe(true);
  });
});

describe("parseDebateTopic", () => {
  it("extracts the topic after a 'debate:' prefix", () => {
    expect(parseDebateTopic("debate: is SQL or NoSQL better?")).toBe(
      "is SQL or NoSQL better?",
    );
  });

  it("is case-insensitive and tolerates missing colon/extra spaces", () => {
    expect(parseDebateTopic("Debate   overfitting vs underfitting")).toBe(
      "overfitting vs underfitting",
    );
  });

  it("returns null for a plain question with no debate prefix", () => {
    expect(parseDebateTopic("what is overfitting?")).toBeNull();
  });

  it("returns null when the prefix has no topic after it", () => {
    expect(parseDebateTopic("debate:")).toBeNull();
  });
});
