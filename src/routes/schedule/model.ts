import { t } from 'elysia';

const recurringSchema = t.Union([
  t.Literal('daily'),
  t.Literal('weekly'),
  t.Literal('monthly'),
]);
const statusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('done'),
  t.Literal('cancelled'),
]);

export const scheduleIdParam = t.Object({ id: t.String() });

export const listQuery = t.Object({
  date: t.Optional(t.String()),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  filter: t.Optional(t.String()),
  status: t.Optional(t.Union([statusSchema, t.Literal('all')])),
  limit: t.Optional(t.String()),
});

export const createBody = t.Object({
  date: t.String({ minLength: 1 }),
  event: t.String({ minLength: 1 }),
  time: t.Optional(t.String()),
  notes: t.Optional(t.String()),
  recurring: t.Optional(recurringSchema),
});

export const updateBody = t.Object({
  date: t.Optional(t.String({ minLength: 1 })),
  event: t.Optional(t.String({ minLength: 1 })),
  time: t.Optional(t.String()),
  notes: t.Optional(t.String()),
  recurring: t.Optional(recurringSchema),
  status: t.Optional(statusSchema),
});
