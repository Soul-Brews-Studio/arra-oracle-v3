/**
 * Is the Ossie export still valid — cheap enough to answer every few seconds (#3110 topology).
 *
 * Two answers, never mixed up:
 *   check     the rules apache/ossie validation/validate.py applies to ontology documents,
 *             restated here (root fields, unique names, every extends / role / identify_by
 *             resolving, verbalizations naming the roles). Runs in-process on every call.
 *   official  the last run of the real validator, written by scripts/arra-proof/ossie-validate.sh
 *             to <data dir>/ossie-validation.json, plus whether it validated THIS export
 *             (sha256 of the compact JSON). Python is never run from the server.
 */

import { createHash } from 'crypto';
import { arraOntology, OSSIE_VERSION, type OssieOntology } from './ontology.ts';
import { readJson } from './state.ts';

export const OSSIE_BUILT_INS = ['Any', 'Boolean', 'Date', 'DateTime', 'Decimal', 'Float', 'Integer', 'String'] as const;
export const VALIDATION_FILE = 'ossie-validation.json';

export interface OssieCheck { ok: boolean; errors: string[]; concepts: number; relationships: number }

export function checkOssie(o: OssieOntology): OssieCheck {
  const errors: string[] = [];
  if (o.version !== OSSIE_VERSION) errors.push(`version is ${o.version}, the schema wants ${OSSIE_VERSION}`);
  if (!o.name) errors.push('name is missing');
  if (!Array.isArray(o.ontology) || o.ontology.length === 0) errors.push('ontology has no concepts');
  const concepts = o.ontology ?? [];
  const declared = new Set<string>();
  for (const c of concepts) {
    if (declared.has(c.concept)) errors.push(`duplicate concept ${c.concept}`);
    declared.add(c.concept);
  }
  const known = (n: string) => declared.has(n) || (OSSIE_BUILT_INS as readonly string[]).includes(n);
  let relationships = 0;
  for (const c of concepts) {
    for (const base of c.extends ?? []) if (!known(base)) errors.push(`${c.concept} extends unknown ${base}`);
    const names = new Set<string>();
    for (const r of c.relationships ?? []) {
      relationships += 1;
      if (names.has(r.name)) errors.push(`${c.concept}.${r.name} declared twice`);
      names.add(r.name);
      if (!r.verbalizes?.length) errors.push(`${c.concept}.${r.name} has no verbalizes`);
      for (const role of r.roles ?? []) if (!known(role.concept)) errors.push(`${c.concept}.${r.name} role ${role.concept} is unknown`);
      const want = [c.concept, ...(r.roles ?? []).map((x) => (x.name ? `${x.concept}:${x.name}` : x.concept))];
      for (const v of r.verbalizes ?? []) {
        const holes = [...v.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
        if (holes.join('|') !== want.join('|')) errors.push(`${c.concept}.${r.name} verbalizes "${v}" does not name its roles`);
      }
    }
    for (const id of c.identify_by ?? []) if (!names.has(id)) errors.push(`${c.concept} identify_by ${id} is not one of its relationships`);
  }
  return { ok: errors.length === 0, errors, concepts: concepts.length, relationships };
}

/** sha256 of the compact JSON; the validate script hashes the file it checked the same way. */
export const ossieHash = (o: unknown) => createHash('sha256').update(JSON.stringify(o)).digest('hex');

export interface OfficialValidation { at: string; passed: boolean; ossieRef: string; sha256: string; from?: string }

export function ossieStatus(dir?: string) {
  const doc = arraOntology();
  const sha256 = ossieHash(doc);
  const last = readJson<OfficialValidation | null>(VALIDATION_FILE, null, dir);
  return {
    url: '/api/arra/ontology?format=ossie',
    version: doc.version,
    name: doc.name,
    sha256,
    check: checkOssie(doc),
    official: last ? { ...last, current: last.sha256 === sha256 } : null,
  };
}
