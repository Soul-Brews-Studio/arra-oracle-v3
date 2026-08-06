import type { MessageRole, ThreadStatus } from './types.ts';

const threadStatuses = new Set<ThreadStatus>(['active', 'answered', 'pending', 'closed']);
const messageRoles = new Set<MessageRole>(['human', 'oracle', 'claude']);

export function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must not be blank`);
  return trimmed;
}

export function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function validThreadId(threadId: unknown): threadId is number {
  return typeof threadId === 'number' && Number.isSafeInteger(threadId) && threadId > 0;
}

export function validateStatus(status: ThreadStatus): ThreadStatus {
  if (!threadStatuses.has(status)) throw new Error(`Invalid thread status: ${status}`);
  return status;
}

export function validateRole(role: MessageRole): MessageRole {
  if (!messageRoles.has(role)) throw new Error(`Invalid message role: ${role}`);
  return role;
}

export function normalizeStoredStatus(value: unknown): ThreadStatus {
  return threadStatuses.has(value as ThreadStatus) ? value as ThreadStatus : 'active';
}

export function normalizeStoredRole(value: unknown): MessageRole {
  return messageRoles.has(value as MessageRole) ? value as MessageRole : 'oracle';
}

export function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`${label} must be an integer between ${min} and ${max}`);
  return Math.min(value, max);
}

export function optionalCount(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}
