/**
 * `arra discover` — which machines on the tailnet run an arra hub.
 *
 * Reads the peer list from `tailscale status --json` (online peers + this machine), then asks
 * each one GET /api/v1/federation/hub on the arra port, in parallel, 1.5 s each. Only answers
 * that name a hub are listed. `hosts` (comma list) skips tailscale and probes exactly those.
 */

const PROBE_MS = 1500;

interface TsPeer { HostName?: string; DNSName?: string; TailscaleIPs?: string[]; Online?: boolean }

export function tailnetHosts(): string[] {
  const proc = Bun.spawnSync(['tailscale', 'status', '--json'], { stdout: 'pipe', stderr: 'pipe', timeout: 5000 });
  if (proc.exitCode !== 0) return [];
  try {
    const status = JSON.parse(proc.stdout.toString()) as { Self?: TsPeer; Peer?: Record<string, TsPeer> };
    const peers = [status.Self, ...Object.values(status.Peer ?? {}).filter((p) => p.Online)].filter(Boolean) as TsPeer[];
    return [...new Set(peers.map((p) => p.DNSName?.replace(/\.$/, '') || p.TailscaleIPs?.[0] || '').filter(Boolean))];
  } catch {
    return [];
  }
}

export async function probeHub(host: string, port: number) {
  const url = `http://${host}:${port}`;
  try {
    const res = await fetch(`${url}/api/v1/federation/hub`, { signal: AbortSignal.timeout(PROBE_MS) });
    if (!res.ok) return null;
    const body = await res.json() as { hub?: string; nodes?: number; sha?: string | null };
    return body.hub ? { hub: body.hub, url, nodes: body.nodes ?? 0, sha: body.sha ?? null } : null;
  } catch {
    return null;
  }
}

export async function discoverHubs(opts: { port?: number; hosts?: string | string[] } = {}) {
  const port = opts.port ?? Number(process.env.ORACLE_PORT || 47778);
  const given = typeof opts.hosts === 'string' ? opts.hosts.split(',') : opts.hosts;
  const hosts = (given?.map((h) => h.trim()).filter(Boolean)) ?? tailnetHosts();
  const found = (await Promise.all(hosts.map((h) => probeHub(h, port)))).filter((x): x is NonNullable<typeof x> => !!x);
  return { port, probed: hosts.length, hubs: found };
}
