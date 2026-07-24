import { describe, expect, it } from "bun:test";
import {
  DEBATE_PERSONAS,
  buildDebateHistory,
  debateTopicPrompt,
  type DebateTurn,
} from "../src/debate";

const [instructor, skeptic] = DEBATE_PERSONAS;

describe("buildDebateHistory", () => {
  it("starts with the topic prompt as a user message when there's no transcript yet", () => {
    const history = buildDebateHistory("overfitting", [], instructor);
    expect(history).toEqual([
      { role: "user", content: debateTopicPrompt("overfitting") },
    ]);
  });

  it("maps the current persona's own turns to assistant messages", () => {
    const transcript: DebateTurn[] = [
      { persona: instructor.name, text: "Overfitting is when a model memorizes noise." },
    ];
    const history = buildDebateHistory("overfitting", transcript, instructor);
    expect(history).toEqual([
      { role: "user", content: debateTopicPrompt("overfitting") },
      { role: "assistant", content: "Overfitting is when a model memorizes noise." },
    ]);
  });

  it("maps the other persona's turns to user messages prefixed with their name", () => {
    const transcript: DebateTurn[] = [
      { persona: instructor.name, text: "Overfitting is when a model memorizes noise." },
    ];
    const history = buildDebateHistory("overfitting", transcript, skeptic);
    expect(history).toEqual([
      { role: "user", content: debateTopicPrompt("overfitting") },
      {
        role: "user",
        content: `${instructor.name}: Overfitting is when a model memorizes noise.`,
      },
    ]);
  });

  it("alternates roles correctly across a multi-turn transcript", () => {
    const transcript: DebateTurn[] = [
      { persona: instructor.name, text: "point one" },
      { persona: skeptic.name, text: "but what about X?" },
      { persona: instructor.name, text: "good question, here's why" },
    ];
    const history = buildDebateHistory("topic", transcript, instructor);
    expect(history.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(history[2]).toEqual({ role: "user", content: `${skeptic.name}: but what about X?` });
  });
});
