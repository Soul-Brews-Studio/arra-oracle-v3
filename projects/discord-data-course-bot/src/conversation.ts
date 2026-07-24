import { asc, eq } from "drizzle-orm";
import type { AppDatabase } from "./db/index.ts";
import { threadMessages, threads } from "./db/schema.ts";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

// Last N turns kept as context on each call — bounds prompt size for long
// threads instead of replaying the whole history forever.
const MAX_HISTORY_TURNS = 20;

export function isTrackedThread(db: AppDatabase, threadId: string): boolean {
  const row = db
    .select({ id: threads.id })
    .from(threads)
    .where(eq(threads.id, threadId))
    .get();
  return row !== undefined;
}

export function createThreadRecord(
  db: AppDatabase,
  threadId: string,
  channelId: string,
  topic: string,
): void {
  db.insert(threads).values({ id: threadId, channelId, topic }).run();
}

export function getHistory(db: AppDatabase, threadId: string): ConversationTurn[] {
  const rows = db
    .select({ role: threadMessages.role, content: threadMessages.content })
    .from(threadMessages)
    .where(eq(threadMessages.threadId, threadId))
    .orderBy(asc(threadMessages.createdAt), asc(threadMessages.id))
    .all();

  return rows.slice(-MAX_HISTORY_TURNS).map((row) => ({
    role: row.role as "user" | "assistant",
    content: row.content,
  }));
}

export function appendMessage(
  db: AppDatabase,
  threadId: string,
  role: "user" | "assistant",
  content: string,
): void {
  db.insert(threadMessages).values({ threadId, role, content }).run();
}
