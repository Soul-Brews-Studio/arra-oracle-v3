import type { Command } from 'commander';
import { oracleFetch } from '../http.ts';
import { printJson } from '../format.ts';

export function registerRead(program: Command): void {
  program
    .command('read <file-or-id>')
    .description('Read an Oracle document by file path or document ID')
    .option('--json', 'Output raw JSON')
    .action(async (fileOrId, opts) => {
      const isFile = fileOrId.includes('/') || fileOrId.endsWith('.md');
      const query = isFile
        ? { file: fileOrId }
        : { id: fileOrId };

      const data = await oracleFetch('/api/read', { query });

      if (opts.json) return printJson(data);

      if (data.error) {
        console.error(`Error: ${data.error}`);
        process.exit(1);
      }

      console.log(data.content);
    });
}
