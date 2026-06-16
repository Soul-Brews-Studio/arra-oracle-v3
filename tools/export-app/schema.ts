import { EXPORT_FORMATS } from './formats.ts';

const manifestRequired = [
  'exportedAt',
  'dbPath',
  'formats',
  'files',
  'collectionCount',
  'collections',
  'rowCount',
  'relationshipCount',
  'documentCount',
] as const;

const nonNegativeInteger = { type: 'integer', minimum: 0 } as const;
const sha256Pattern = '^[a-f0-9]{64}$';

export const EXPORT_MANIFEST_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://buildwithoracle.com/schemas/arra-oracle/export-manifest.schema.json',
  title: 'Arra Oracle Export Manifest',
  type: 'object',
  additionalProperties: false,
  required: manifestRequired,
  properties: {
    exportedAt: { type: 'string', format: 'date-time' },
    dbPath: { type: 'string', minLength: 1 },
    formats: {
      type: 'array',
      minItems: 1,
      items: { enum: EXPORT_FORMATS },
    },
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'bytes', 'sha256'],
        properties: {
          path: { type: 'string', minLength: 1 },
          bytes: nonNegativeInteger,
          sha256: { type: 'string', pattern: sha256Pattern },
        },
      },
    },
    collectionCount: nonNegativeInteger,
    collections: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['rowCount'],
        properties: { rowCount: nonNegativeInteger },
      },
    },
    rowCount: nonNegativeInteger,
    relationshipCount: nonNegativeInteger,
    documentCount: nonNegativeInteger,
  },
} as const;
