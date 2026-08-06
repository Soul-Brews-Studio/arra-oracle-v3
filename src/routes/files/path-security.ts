import path from 'path';

export function pathWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function safePluginWasmFileName(name: string): string | null {
  const file = name.endsWith('.wasm') ? name : `${name}.wasm`;
  if (!file || file === '.wasm' || file.includes('\0') || file.includes('/') || file.includes('\\')) return null;
  if (file.includes('..') || path.basename(file) !== file) return null;
  return file;
}
