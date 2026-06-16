import { t } from 'elysia';

export const scheduleIdParam = t.Object({ id: t.String() });

export const listQuery = t.Object({
  date: t.Optional(t.String()),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  filter: t.Optional(t.String()),
  status: t.Optional(t.String()),
  limit: t.Optional(t.String()),
});

const scheduleStatus = t.Union([t.Literal('pending'), t.Literal('done'), t.Literal('cancelled')]);
const recurring = t.Union([t.Literal('daily'), t.Literal('weekly'), t.Literal('monthly')]);

export const createBody = t.Object({
  date: t.String({ minLength: 1 }),
  event: t.String({ minLength: 1 }),
  time: t.Optional(t.String()),
  notes: t.Optional(t.String()),
  recurring: t.Optional(recurring),
});

export const updateBody = t.Object({
  date: t.Optional(t.String({ minLength: 1 })),
  event: t.Optional(t.String({ minLength: 1 })),
  time: t.Optional(t.String()),
  notes: t.Optional(t.String()),
  recurring: t.Optional(recurring),
  status: t.Optional(scheduleStatus),
});
