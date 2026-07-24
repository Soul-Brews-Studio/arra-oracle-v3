import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// One row per Discord thread the bot opened to answer a student's question.
export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(), // Discord thread (channel) ID
  channelId: text("channel_id").notNull(), // parent channel the thread was opened from
  topic: text("topic"), // opening question, informational only
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
});

// One row per conversation turn in a thread, replayed as multi-turn context
// on every new message so the bot stays on that thread's specific topic
// across restarts (see src/conversation.ts).
export const threadMessages = sqliteTable(
  "thread_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    threadId: text("thread_id").notNull(), // FK -> threads.id
    role: text("role").notNull(), // 'user' | 'assistant'
    content: text("content").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => [index("idx_thread_messages_thread").on(table.threadId)],
);
