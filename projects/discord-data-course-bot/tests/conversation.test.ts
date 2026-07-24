import { beforeEach, describe, expect, it } from "bun:test";
import {
  appendMessage,
  createThreadRecord,
  getHistory,
  isTrackedThread,
} from "../src/conversation";
import { createDatabase, type AppDatabase } from "../src/db/index.ts";

let db: AppDatabase;

beforeEach(() => {
  db = createDatabase(":memory:").db;
});

describe("isTrackedThread", () => {
  it("is false for a thread the bot never created", () => {
    expect(isTrackedThread(db, "unknown-thread")).toBe(false);
  });

  it("is true once a thread record exists", () => {
    createThreadRecord(db, "thread-1", "channel-1", "what is overfitting?");
    expect(isTrackedThread(db, "thread-1")).toBe(true);
  });
});

describe("getHistory / appendMessage", () => {
  it("returns an empty history for a thread with no messages", () => {
    createThreadRecord(db, "thread-1", "channel-1", "topic");
    expect(getHistory(db, "thread-1")).toEqual([]);
  });

  it("returns turns in insertion order", () => {
    createThreadRecord(db, "thread-1", "channel-1", "topic");
    appendMessage(db, "thread-1", "user", "what is overfitting?");
    appendMessage(db, "thread-1", "assistant", "it's when a model memorizes noise.");
    appendMessage(db, "thread-1", "user", "how do I avoid it?");

    expect(getHistory(db, "thread-1")).toEqual([
      { role: "user", content: "what is overfitting?" },
      { role: "assistant", content: "it's when a model memorizes noise." },
      { role: "user", content: "how do I avoid it?" },
    ]);
  });

  it("keeps history scoped to its own thread", () => {
    createThreadRecord(db, "thread-1", "channel-1", "topic a");
    createThreadRecord(db, "thread-2", "channel-1", "topic b");
    appendMessage(db, "thread-1", "user", "question about topic a");
    appendMessage(db, "thread-2", "user", "question about topic b");

    expect(getHistory(db, "thread-1")).toEqual([
      { role: "user", content: "question about topic a" },
    ]);
    expect(getHistory(db, "thread-2")).toEqual([
      { role: "user", content: "question about topic b" },
    ]);
  });

  it("caps history to the most recent turns", () => {
    createThreadRecord(db, "thread-1", "channel-1", "topic");
    for (let i = 0; i < 25; i++) {
      appendMessage(db, "thread-1", "user", `turn ${i}`);
    }

    const history = getHistory(db, "thread-1");
    expect(history.length).toBe(20);
    expect(history[0]?.content).toBe("turn 5");
    expect(history.at(-1)?.content).toBe("turn 24");
  });
});
