const files = [
  'benchmarks/menu-query.bench.ts',
  'benchmarks/plugin-load.bench.ts',
  'benchmarks/vector-search.bench.ts',
  'benchmarks/mcp-tool-dispatch.bench.ts',
];

for (const file of files) {
  console.log(`\n== ${file} ==`);
  const proc = Bun.spawn(['bun', 'run', file], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
}
