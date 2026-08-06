const FORMAT_RE = /^[a-z0-9-]+$/;

export interface UnifiedExportFormatManifest {
  name: string;
  handler: string;
}

export function validateExportFormatManifests(formats: UnifiedExportFormatManifest[]): void {
  for (const format of formats) {
    if (!FORMAT_RE.test(format.name)) {
      throw new Error(`exportFormats.name must match ${FORMAT_RE}, got: ${JSON.stringify(format.name)}`);
    }
    if (!format.handler || typeof format.handler !== 'string') {
      throw new Error(`exportFormats.${format.name}.handler must be a string`);
    }
  }
}
