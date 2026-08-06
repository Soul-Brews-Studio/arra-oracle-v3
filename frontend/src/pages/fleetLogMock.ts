export const FLEET_CHANNELS = ['maw', 'vault', 'webhook', 'discord', 'agent-team', 'git'] as const;
export type FleetChannel = typeof FLEET_CHANNELS[number];
export type FleetDirection = 'outbound' | 'inbound' | 'forwarded' | null;

export type FleetMessage = {
  id: string;
  tenantId: string;
  channel: FleetChannel;
  source: string | null;
  direction: FleetDirection;
  fromId: string | null;
  toId: string | null;
  threadKey: string | null;
  text: string | null;
  raw: string | null;
  rawPath: string | null;
  ts: number;
  ingestedAt: number;
};

export type FleetLogFilters = {
  query: string;
  channels: FleetChannel[];
  from: string;
  to: string;
  since: string;
  until: string;
};

export const FLEET_SEARCH_CONTRACT = 'GET /api/fleet-log/search?query=&channel=&from=&to=&since=&until=';
export const FLEET_THREAD_CONTRACT = 'GET /api/fleet-log/thread/:key';

const at = (value: string) => Date.parse(value);

export const mockFleetMessages: FleetMessage[] = [
  {
    id: 'fl_mock_001',
    tenantId: 'default',
    channel: 'vault',
    source: 'arra-oracle-v3',
    direction: 'inbound',
    fromId: 'm5:digger',
    toId: 'digger',
    threadKey: 'vault:digger|m5:digger:2026-07-11T04:00Z',
    text: 'ralph-dig complete: fleet log schema survey found ψ/inbox frontmatter is stable enough for phase-1 vault ingestion.',
    raw: '{"frontmatter":{"read":false}}',
    rawPath: 'ψ/inbox/2026-07-11_04-02_m5-digger_fleet-log-schema-survey.md',
    ts: at('2026-07-11T04:02:33.641Z'),
    ingestedAt: at('2026-07-11T04:03:10.000Z'),
  },
  {
    id: 'fl_mock_002',
    tenantId: 'default',
    channel: 'vault',
    source: 'arra-oracle-v3',
    direction: 'outbound',
    fromId: 'digger',
    toId: 'm5:digger',
    threadKey: 'vault:digger|m5:digger:2026-07-11T04:00Z',
    text: 'Ack. Keep rawPath, raw frontmatter, and threadKey approximate; do not infer a hard thread id from vault filenames.',
    raw: '{"frontmatter":{"read":true}}',
    rawPath: 'ψ/outbox/2026-07-11_04-08_digger_thread-key-ack.md',
    ts: at('2026-07-11T04:08:21.120Z'),
    ingestedAt: at('2026-07-11T04:08:58.000Z'),
  },
  {
    id: 'fl_mock_003',
    tenantId: 'default',
    channel: 'maw',
    source: 'message-ledger.sqlite',
    direction: 'forwarded',
    fromId: 'claude48',
    toId: 'm5:arra-oracle-v3',
    threadKey: 'maw:claude48|m5:arra-oracle-v3:2026-07-11T05:30Z',
    text: 'TASK: issue #2765 — build the Fleet Log Reconcile Console page against a local fixture while backend PRs are still in flight.',
    raw: '{"transport":"tmux-inject","ledger":"maw"}',
    rawPath: '~/.maw/message-ledger.sqlite#mock-2765',
    ts: at('2026-07-11T05:31:04.000Z'),
    ingestedAt: at('2026-07-11T05:31:08.000Z'),
  },
  {
    id: 'fl_mock_004',
    tenantId: 'default',
    channel: 'agent-team',
    source: 'omx-team-jsonl',
    direction: 'inbound',
    fromId: 'frontend',
    toId: 'team-lead',
    threadKey: 'agent-team:frontend|team-lead:2026-07-11T05:30Z',
    text: 'Component renders with mocked fleetMessages rows. Filters cover channel, from, to, date range, and full-text query.',
    raw: '{"event":"SendMessage","team":"oracle-ui"}',
    rawPath: '.omx/state/team/oracle-ui/session.jsonl#mock',
    ts: at('2026-07-11T05:42:17.000Z'),
    ingestedAt: at('2026-07-11T05:42:22.000Z'),
  },
  {
    id: 'fl_mock_005',
    tenantId: 'default',
    channel: 'webhook',
    source: 'webhook-relay-v3',
    direction: 'inbound',
    fromId: 'line:customer-17',
    toId: 'oracle-support',
    threadKey: 'webhook:line:customer-17|oracle-support:2026-07-10T23:00Z',
    text: 'Pointer mirror received for customer escalation; raw LINE content remains external and only the source pointer is reconciled here.',
    raw: '{"pointerOnly":true,"privacy":"external-content-redacted"}',
    rawPath: 'webhook-relay-v3://events/evt_7bd_mock',
    ts: at('2026-07-10T23:11:48.000Z'),
    ingestedAt: at('2026-07-10T23:12:05.000Z'),
  },
  {
    id: 'fl_mock_006',
    tenantId: 'default',
    channel: 'discord',
    source: 'discord-native',
    direction: 'inbound',
    fromId: 'discord:ops-room',
    toId: 'claude-code',
    threadKey: 'discord:claude-code|discord:ops-room:2026-07-10T22:30Z',
    text: 'Ops room asked whether silent maw agents should be included in phase 5 git-log ingestion. Deferred after console MVP.',
    raw: '{"channelBinding":"claude-code","messageContentLogged":false}',
    rawPath: null,
    ts: at('2026-07-10T22:37:29.000Z'),
    ingestedAt: at('2026-07-10T22:38:00.000Z'),
  },
  {
    id: 'fl_mock_007',
    tenantId: 'default',
    channel: 'git',
    source: 'alpha',
    direction: null,
    fromId: 'git:feat/2763-fleet-log',
    toId: 'alpha',
    threadKey: 'git:alpha|git:feat/2763-fleet-log:2026-07-10T21:00Z',
    text: 'Schema branch advertises fleet_messages indexes for channel+ts, from_id, to_id, thread_key, and tenant+ts.',
    raw: '{"ref":"feat/2763-fleet-log","event":"commit"}',
    rawPath: 'git://Soul-Brews-Studio/arra-oracle-v3/feat/2763-fleet-log',
    ts: at('2026-07-10T21:14:44.000Z'),
    ingestedAt: at('2026-07-10T21:15:01.000Z'),
  },
  {
    id: 'fl_mock_008',
    tenantId: 'default',
    channel: 'maw',
    source: 'message-ledger.sqlite',
    direction: 'outbound',
    fromId: 'm5:arra-oracle-v3',
    toId: 'claude48',
    threadKey: 'maw:claude48|m5:arra-oracle-v3:2026-07-11T05:30Z',
    text: 'starting #2765 — plan: inspect issue, mirror existing dashboard convention, add fixture-backed page, validate tsc and screenshot.',
    raw: '{"transport":"tmux-inject","ack":true}',
    rawPath: '~/.maw/message-ledger.sqlite#mock-ack',
    ts: at('2026-07-11T05:32:02.000Z'),
    ingestedAt: at('2026-07-11T05:32:05.000Z'),
  },
];

function includes(value: string | null, query: string): boolean {
  return value?.toLowerCase().includes(query.toLowerCase()) ?? false;
}

function afterDate(ts: number, since: string): boolean {
  return !since || ts >= new Date(`${since}T00:00:00`).getTime();
}

function beforeDate(ts: number, until: string): boolean {
  return !until || ts <= new Date(`${until}T23:59:59.999`).getTime();
}

export function searchMockFleetMessages(filters: FleetLogFilters): FleetMessage[] {
  const q = filters.query.trim();
  const from = filters.from.trim().toLowerCase();
  const to = filters.to.trim().toLowerCase();
  return mockFleetMessages
    .filter((message) => !filters.channels.length || filters.channels.includes(message.channel))
    .filter((message) => !from || includes(message.fromId, from))
    .filter((message) => !to || includes(message.toId, to))
    .filter((message) => !q || includes(message.text, q))
    .filter((message) => afterDate(message.ts, filters.since) && beforeDate(message.ts, filters.until))
    .sort((left, right) => right.ts - left.ts);
}

export function mockFleetThread(threadKey: string): FleetMessage[] {
  return mockFleetMessages
    .filter((message) => message.threadKey === threadKey)
    .sort((left, right) => left.ts - right.ts);
}
