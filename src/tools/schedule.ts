/**
 * Oracle Schedule Handler (Drizzle DB)
 *
 * Source of truth: `schedule` table in oracle.db
 * Auto-exports to ORACLE_DATA_DIR/ψ/inbox/schedule.md on write (see const.ts).
 *
 * Supports:
 * - Add/list events with proper YYYY-MM-DD date queries
 * - Filter by day, range, or keyword
 * - Status: pending / done / cancelled
 * - Recurring events (daily/weekly/monthly)
 */

import fs from 'fs';
import path from 'path';
import { eq, and, gte, lte, like, asc, or } from 'drizzle-orm';
import { schedule } from '../db/schema.ts';
import type { ToolContext, ToolResponse, OracleScheduleAddInput, OracleScheduleListInput } from './types.ts';
import { SCHEDULE_PATH } from '../config.ts';

function getSchedulePath(): string {
  return SCHEDULE_PATH;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  // Thai abbreviated months (formal: ม.ค., common: มค.)
  'ม.ค.': 1, 'มค.': 1, 'มค': 1,
  'ก.พ.': 2, 'กพ.': 2, 'กพ': 2,
  'มี.ค.': 3, 'มีค.': 3, 'มีค': 3,
  'เม.ย.': 4, 'เมย.': 4, 'เมย': 4,
  'พ.ค.': 5, 'พค.': 5, 'พค': 5,
  'มิ.ย.': 6, 'มิย.': 6, 'มิย': 6,
  'ก.ค.': 7, 'กค.': 7, 'กค': 7,
  'ส.ค.': 8, 'สค.': 8, 'สค': 8,
  'ก.ย.': 9, 'กย.': 9, 'กย': 9,
  'ต.ค.': 10, 'ตค.': 10, 'ตค': 10,
  'พ.ย.': 11, 'พย.': 11, 'พย': 11,
  'ธ.ค.': 12, 'ธค.': 12, 'ธค': 12,
};

/**
 * Parse flexible date input to YYYY-MM-DD.
 * Handles: "5 Mar", "2026-03-05", "March 5", "5/3", "tomorrow", "today"
 */
export function parseDate(input: string): string {
  const trimmed = input.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const now = new Date();
  const thisYear = now.getFullYear();

  // Relative: today/tomorrow
  if (/^today$/i.test(trimmed)) return fmtLocal(now);
  if (/^tomorrow$/i.test(trimmed)) {
    now.setDate(now.getDate() + 1);
    return fmtLocal(now);
  }

  // "5 Mar", "5 March", "5 Mar 2026", "Mar 5", "March 5 2026"
  const monthNameMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-zก-๙.]+)(?:\s+(\d{4}))?$/i)
    || trimmed.match(/^([A-Za-zก-๙.]+)\s+(\d{1,2})(?:[,\s]+(\d{4}))?$/i);
  if (monthNameMatch) {
    let day: number, monthStr: string, yearStr: string | undefined;
    if (/^\d/.test(monthNameMatch[1])) {
      day = parseInt(monthNameMatch[1]);
      monthStr = monthNameMatch[2];
      yearStr = monthNameMatch[3];
    } else {
      monthStr = monthNameMatch[1];
      day = parseInt(monthNameMatch[2]);
      yearStr = monthNameMatch[3];
    }
    const month = MONTHS[monthStr.toLowerCase()] || MONTHS[monthStr];
    if (month && day >= 1 && day <= 31) {
      const year = yearStr ? parseInt(yearStr) : thisYear;
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // DD/MM or DD/MM/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1]);
    const month = parseInt(slashMatch[2]);
    const year = slashMatch[3]
      ? (slashMatch[3].length === 2 ? 2000 + parseInt(slashMatch[3]) : parseInt(slashMatch[3]))
      : thisYear;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Fallback: store with today's date
  return fmtLocal(now);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Format date in local timezone (avoids UTC shift issues) */
function fmtLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ============================================================================
// Tool definitions
// ============================================================================

export const scheduleAddToolDef = {
  name: 'arra_schedule_add',
  description: 'Add an appointment or event to the shared schedule. The schedule is per-human (not per-project) and shared across all Oracles.',
  inputSchema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Date of the event (e.g. "5 Mar", "2026-03-05", "tomorrow", "28 ก.พ.")'
      },
      event: {
        type: 'string',
        description: 'Event description (e.g. "นัดอ.เศรษฐ์", "Team standup")'
      },
      time: {
        type: 'string',
        description: 'Optional time (e.g. "14:00", "TBD")'
      },
      notes: {
        type: 'string',
        description: 'Optional notes about the event'
      },
      recurring: {
        type: 'string',
        description: 'Optional recurrence: "daily", "weekly", "monthly"',
        enum: ['daily', 'weekly', 'monthly']
      }
    },
    required: ['date', 'event']
  }
};

export const scheduleListToolDef = {
  name: 'arra_schedule_list',
  description: 'List appointments from the shared schedule. Filter by date, range, or keyword. Defaults to today + 14 days.',
  inputSchema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Specific date to query (e.g. "2026-03-05", "today", "tomorrow")'
      },
      from: {
        type: 'string',
        description: 'Range start date (inclusive). Defaults to today.'
      },
      to: {
        type: 'string',
        description: 'Range end date (inclusive). Defaults to 14 days from now.'
      },
      filter: {
        type: 'string',
        description: 'Keyword to filter events (e.g. "standup", "เศรษฐ์")'
      },
      status: {
        type: 'string',
        description: 'Filter by status',
        enum: ['pending', 'done', 'cancelled', 'all']
      },
      limit: {
        type: 'number',
        description: 'Max results (default 50)'
      }
    }
  }
};

// ============================================================================
// Handlers
// ============================================================================

export async function handleScheduleAdd(ctx: ToolContext, input: OracleScheduleAddInput): Promise<ToolResponse> {
  const { event, time, notes } = input;
  const dateCanonical = parseDate(input.date);
  const now = Date.now();

  const result = ctx.db.insert(schedule).values({
    date: dateCanonical,
    dateRaw: input.date,
    time: time || null,
    event,
    notes: notes || null,
    recurring: input.recurring || null,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }).returning({ id: schedule.id }).get();

  // Auto-export to schedule.md
  exportScheduleToMarkdown(ctx);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        id: result.id,
        date: dateCanonical,
        dateRaw: input.date,
        event,
        time: time || 'TBD',
        notes: notes || '',
        message: 'Event added to schedule'
      }, null, 2)
    }]
  };
}

export async function handleScheduleList(ctx: ToolContext, input: OracleScheduleListInput): Promise<ToolResponse> {
  const limit = input.limit || 50;
  const statusFilter = input.status || 'pending';

  // Build where conditions
  const conditions = [];

  if (statusFilter !== 'all') {
    conditions.push(eq(schedule.status, statusFilter));
  }

  if (input.date) {
    // Single day query
    const day = parseDate(input.date);
    conditions.push(eq(schedule.date, day));
  } else {
    // Range query
    const from = input.from ? parseDate(input.from) : fmt(new Date());
    const to = input.to ? parseDate(input.to) : (() => {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      return fmt(d);
    })();
    conditions.push(gte(schedule.date, from));
    conditions.push(lte(schedule.date, to));
  }

  if (input.filter) {
    conditions.push(or(
      like(schedule.event, `%${input.filter}%`),
      like(schedule.notes, `%${input.filter}%`)
    )!);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const events = ctx.db.select()
    .from(schedule)
    .where(where)
    .orderBy(asc(schedule.date), asc(schedule.time))
    .limit(limit)
    .all();

  // Group by date for calendar-style output
  const byDate: Record<string, typeof events> = {};
  for (const ev of events) {
    if (!byDate[ev.date]) byDate[ev.date] = [];
    byDate[ev.date].push(ev);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        total: events.length,
        events: events.map(e => ({
          id: e.id,
          date: e.date,
          dateRaw: e.dateRaw,
          time: e.time || 'TBD',
          event: e.event,
          notes: e.notes,
          recurring: e.recurring,
          status: e.status,
        })),
        byDate,
      }, null, 2)
    }]
  };
}

// ============================================================================
// Markdown export (auto-syncs DB → schedule.md)
// ============================================================================

function exportScheduleToMarkdown(ctx: ToolContext): void {
  const events = ctx.db.select()
    .from(schedule)
    .where(eq(schedule.status, 'pending'))
    .orderBy(asc(schedule.date), asc(schedule.time))
    .all();

  // Group by month
  const byMonth: Record<string, typeof events> = {};
  for (const ev of events) {
    const month = ev.date.slice(0, 7); // YYYY-MM
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(ev);
  }

  let md = `# Schedule\n\n**Updated**: ${fmt(new Date())}\n**Source**: oracle.db (auto-generated)\n`;

  for (const [month, monthEvents] of Object.entries(byMonth).sort()) {
    const d = new Date(month + '-01');
    const monthName = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    md += `\n## ${monthName}\n\n`;
    md += `| Date | Time | Event | Notes |\n`;
    md += `|------|------|-------|-------|\n`;
    for (const ev of monthEvents) {
      const dateDisplay = ev.dateRaw || ev.date;
      const recur = ev.recurring ? ` (${ev.recurring})` : '';
      md += `| ${dateDisplay} | ${ev.time || 'TBD'} | ${ev.event}${recur} | ${ev.notes || ''} |\n`;
    }
  }

  // Recurring section
  const recurring = events.filter(e => e.recurring);
  if (recurring.length > 0) {
    md += `\n## Recurring\n\n`;
    md += `| Day | Time | Event |\n`;
    md += `|-----|------|-------|\n`;
    for (const ev of recurring) {
      md += `| ${ev.recurring} | ${ev.time || 'TBD'} | ${ev.event} |\n`;
    }
  }

  md += `\n---\n\nManaged by Oracle. Add events via \`arra_schedule_add\` or the web UI.\n`;

  const schedulePath = getSchedulePath();
  fs.mkdirSync(path.dirname(schedulePath), { recursive: true });
  fs.writeFileSync(schedulePath, md, 'utf-8');
}
