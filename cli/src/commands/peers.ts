export async function peersCommand(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('arra-cli peers [--token <token>] [--json]\n');
    console.log('Probe configured federation peers from ARRA_NAMED_PEERS or peers.json.');
    return 0;
  }
  const tokenIndex = args.indexOf('--token');
  const token = tokenIndex >= 0 ? args[tokenIndex + 1] : undefined;
  if (tokenIndex >= 0 && !token) { console.error('usage: arra-cli peers --token <token>'); return 1; }
  const json = args.includes('--json');
  const { listPeerStatuses, formatPeerStatuses } = await import('../../../src/peer/peer-query.ts');
  const statuses = await listPeerStatuses(undefined, { token });
  if (json) console.log(JSON.stringify({ peers: statuses }, null, 2));
  else console.log(formatPeerStatuses(statuses));
  return statuses.every((s: any) => s.ok) ? 0 : 1;
}
