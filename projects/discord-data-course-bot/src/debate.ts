import { generateReply } from "./ai";
import { buildSystemPrompt } from "./course";
import type { ConversationTurn } from "./conversation";

export interface DebatePersona {
  name: string;
  instructions: string;
}

export interface DebateTurn {
  persona: string;
  text: string;
}

// Two fixed personas having an educational back-and-forth about the topic a
// student picks — not a strict pro/con debate (most data-course topics
// aren't two-sided), but a discussion that surfaces both the clear
// explanation and the probing follow-up questions a student should be
// asking themselves.
export const DEBATE_PERSONAS: [DebatePersona, DebatePersona] = [
  {
    name: "Instructor",
    instructions:
      "You are the Instructor in a two-AI classroom discussion happening in front of students. " +
      "Explain the topic clearly and build on the discussion so far. Keep each turn to 2-4 sentences.",
  },
  {
    name: "Skeptic",
    instructions:
      "You are the Skeptic in a two-AI classroom discussion happening in front of students. " +
      "Push back on the Instructor's last point: ask a probing question, raise an edge case, or " +
      "point out a common misconception. Keep each turn to 2-4 sentences.",
  },
];

// Each persona speaks this many times (so total messages = 2 * DEBATE_ROUNDS).
export const DEBATE_ROUNDS = 3;

export function debateTopicPrompt(topic: string): string {
  return `Discuss this topic for the class: ${topic}`;
}

// Builds the message history for one persona's next turn, from that
// persona's own point of view: its own past turns become "assistant"
// messages, the other persona's turns become "user" messages (prefixed with
// the speaker's name so the model can follow who said what).
export function buildDebateHistory(
  topic: string,
  transcript: DebateTurn[],
  currentPersona: DebatePersona,
): ConversationTurn[] {
  const messages: ConversationTurn[] = [
    { role: "user", content: debateTopicPrompt(topic) },
  ];
  for (const turn of transcript) {
    messages.push(
      turn.persona === currentPersona.name
        ? { role: "assistant", content: turn.text }
        : { role: "user", content: `${turn.persona}: ${turn.text}` },
    );
  }
  return messages;
}

export async function runDebate(topic: string): Promise<DebateTurn[]> {
  const transcript: DebateTurn[] = [];

  for (let round = 0; round < DEBATE_ROUNDS; round++) {
    for (const persona of DEBATE_PERSONAS) {
      const history = buildDebateHistory(topic, transcript, persona);
      const systemPrompt = `${buildSystemPrompt()}\n\n${persona.instructions}`;
      const text = await generateReply(systemPrompt, history);
      transcript.push({ persona: persona.name, text });
    }
  }

  return transcript;
}
