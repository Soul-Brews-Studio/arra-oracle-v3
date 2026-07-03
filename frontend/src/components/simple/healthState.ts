export enum HealthState {
  Healthy = 'healthy',
  Starting = 'starting',
  DegradedFts = 'degraded-fts',
  DegradedDb = 'degraded-db',
  DegradedPlugin = 'degraded-plugin',
  Down = 'down',
}

export const HEALTH_STARTING_GRACE_MS = 8_000;
export const HEALTH_STARTING_ESCAPE_MS = 30_000;
export const HEALTH_DOWN_RETRY_COUNT = 3;

type SimpleSubsystem = { status?: string; ok?: boolean };

export interface SimpleHealthPayload {
  status?: string;
  healthStatus?: string;
  state?: string;
  db?: string | { status?: string };
  dbStatus?: string;
  oracle?: string;
  vectorStatus?: string;
  vectorAvailable?: boolean;
  pluginStatus?: string;
  plugins?: { status?: string };
  subsystems?: Partial<Record<string, SimpleSubsystem>>;
  draining?: boolean;
}

export interface HealthStateInput {
  health?: SimpleHealthPayload | null;
  error?: unknown;
  msSinceLoad: number;
  failedPolls?: number;
}

export interface HealthStateCopy {
  title: string;
  detail: string;
  action: string;
  tone: 'good' | 'wait' | 'warn' | 'bad';
}

export const HEALTH_STATE_COPY: Record<HealthState, HealthStateCopy> = {
  [HealthState.Healthy]: {
    title: 'Awake and remembering',
    detail: 'Your Oracle is reachable and ready to search or save memories.',
    action: 'Ask or add a memory.',
    tone: 'good',
  },
  [HealthState.Starting]: {
    title: 'Starting up…',
    detail: 'The server is waking up. This usually clears in a few seconds.',
    action: 'Wait briefly, then retry if it keeps spinning.',
    tone: 'wait',
  },
  [HealthState.DegradedFts]: {
    title: 'Running, but search is limited',
    detail: 'The app is reachable, but the search/vector index is not fully ready.',
    action: 'You can still save memories; rebuild or retry indexing for better search.',
    tone: 'warn',
  },
  [HealthState.DegradedDb]: {
    title: 'Running, but memory storage needs help',
    detail: 'The server responded, but the database is not healthy.',
    action: 'Check ORACLE_DATA_DIR and database permissions, then retry.',
    tone: 'bad',
  },
  [HealthState.DegradedPlugin]: {
    title: 'Running, but a plugin needs attention',
    detail: 'Core memory is available, but one or more plugins reported degraded.',
    action: 'Open plugin settings or disable the failing plugin.',
    tone: 'warn',
  },
  [HealthState.Down]: {
    title: "Can't reach your Oracle",
    detail: 'The browser could not reach the backend health endpoint.',
    action: 'If using Docker, restart the container. If using Bun, run the server again.',
    tone: 'bad',
  },
};

export function mapHealthState(input: HealthStateInput): HealthState {
  const ms = Math.max(0, input.msSinceLoad);
  const failedPolls = Math.max(0, input.failedPolls ?? 0);
  const health = input.health ?? null;

  if (!health || input.error) {
    if (ms < HEALTH_STARTING_GRACE_MS) return HealthState.Starting;
    if (failedPolls >= HEALTH_DOWN_RETRY_COUNT || ms >= HEALTH_STARTING_ESCAPE_MS) return HealthState.Down;
    return HealthState.Starting;
  }

  const legacyStatus = health.status?.toLowerCase();
  const status = (health.healthStatus ?? health.state)?.toLowerCase();
  if (health.draining || status === 'starting' || legacyStatus === 'starting' || legacyStatus === 'draining') return HealthState.Starting;

  if (dbIsBad(health)) return HealthState.DegradedDb;
  if (pluginIsBad(health)) return HealthState.DegradedPlugin;
  if (searchIsLimited(health)) return HealthState.DegradedFts;
  if (status === 'degraded' || legacyStatus === 'degraded') return HealthState.DegradedFts;
  if (status === 'down' || legacyStatus === 'down' || legacyStatus === 'error') return HealthState.Down;
  return HealthState.Healthy;
}

function subsystemStatus(health: SimpleHealthPayload, ...names: string[]): string | undefined {
  for (const name of names) {
    const status = health.subsystems?.[name]?.status;
    if (status) return status;
  }
  return undefined;
}

function dbIsBad(health: SimpleHealthPayload): boolean {
  const dbStatus = typeof health.db === 'string' ? health.db : health.db?.status;
  return [subsystemStatus(health, 'db', 'database'), health.dbStatus, dbStatus, health.oracle]
    .some((value) => ['down', 'error', 'disconnected'].includes(String(value ?? '').toLowerCase()));
}

function pluginIsBad(health: SimpleHealthPayload): boolean {
  const value = subsystemStatus(health, 'plugin', 'plugins') ?? health.pluginStatus ?? health.plugins?.status;
  return ['degraded', 'down', 'error'].includes(String(value ?? '').toLowerCase());
}

function searchIsLimited(health: SimpleHealthPayload): boolean {
  const fts = String(subsystemStatus(health, 'fts') ?? '').toLowerCase();
  const vectorSubsystem = String(subsystemStatus(health, 'vector') ?? '').toLowerCase();
  if (['down', 'error', 'degraded'].includes(fts) || ['down', 'error', 'degraded'].includes(vectorSubsystem)) return true;
  if (health.healthStatus || health.state || health.subsystems) return false;
  const vector = String(health.vectorStatus ?? '').toLowerCase();
  return health.vectorAvailable === false || ['down', 'error', 'degraded'].includes(vector);
}
