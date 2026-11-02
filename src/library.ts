import type { LibraryEntity, LibraryRelation } from './contracts.ts';
import { ensure } from './errors.ts';

const MAX_PAGE = 100;
const REFERENCE_FIELDS = ['authorIds', 'regions', 'traditions', 'disciplines', 'periods'] as const;

export type LibraryFilters = {
  query?: string;
  language?: string;
  kinds?: string[];
  regions?: string[];
  traditions?: string[];
  disciplines?: string[];
  periods?: string[];
  authorIds?: string[];
  fromYear?: number;
  toYear?: number;
  offset?: number;
  limit?: number;
};

export type LibraryPage = { items: LibraryEntity[]; total: number };
export type DocumentedLocation = {
  entityId: string;
  label: string;
  lat: number;
  lon: number;
  role: string;
  evidence: string;
  dates?: string;
};
export type GraphPage = {
  nodes: LibraryEntity[];
  edges: LibraryRelation[];
  total: number;
  legend: string[];
};
export type MergeResult = {
  entities: LibraryEntity[];
  relations: LibraryRelation[];
  redirects: Record<string, string>;
};
export type SplitResult = { entities: LibraryEntity[]; relations: LibraryRelation[] };

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const normaliseLanguage = (value: string): string => value.trim().toLowerCase();

function languageLabel(entity: LibraryEntity, language: string): string | undefined {
  const wanted = normaliseLanguage(language);
  const key = Object.keys(entity.labels).find(candidate => normaliseLanguage(candidate) === wanted);
  return key === undefined ? undefined : entity.labels[key];
}

function preferredLabel(entity: LibraryEntity, language?: string): string {
  if (language) {
    const exact = languageLabel(entity, language);
    if (exact !== undefined && exact.trim()) return exact;
  }
  const keys = Object.keys(entity.labels);
  const portuguese = keys.find(key => normaliseLanguage(key) === 'pt' || normaliseLanguage(key) === 'pt-br');
  if (portuguese !== undefined && entity.labels[portuguese].trim()) return entity.labels[portuguese];
  const values = keys.map(key => entity.labels[key]).filter(value => value.trim());
  values.sort((a, b) => normalize(a).localeCompare(normalize(b)));
  return values[0] ?? entity.id;
}

function hasAny(values: string[], candidates: string[] | undefined, exact = false): boolean {
  if (!candidates || candidates.length === 0) return true;
  const pool = new Set(exact ? candidates : candidates.map(normalize));
  return values.some(value => pool.has(exact ? value : normalize(value)));
}

function matchesDates(entity: LibraryEntity, fromYear?: number, toYear?: number): boolean {
  if (fromYear === undefined && toYear === undefined) return true;
  const { start, end } = entity.dates;
  if (start === null && end === null) return false;
  if (fromYear !== undefined) {
    const latest = end ?? start;
    if (latest === null || latest < fromYear) return false;
  }
  if (toYear !== undefined) {
    const earliest = start ?? end;
    if (earliest === null || earliest > toYear) return false;
  }
  return true;
}

function pageBounds(offset?: number, limit?: number): { offset: number; limit: number } {
  const start = offset ?? 0;
  const size = limit ?? MAX_PAGE;
  ensure(Number.isInteger(start) && start >= 0, 'invalid_offset', 'offset deve ser inteiro não negativo.');
  ensure(Number.isInteger(size) && size > 0, 'invalid_limit', 'limit deve ser inteiro positivo.');
  return { offset: start, limit: Math.min(size, MAX_PAGE) };
}

function validateYears(fromYear?: number, toYear?: number): void {
  ensure(fromYear === undefined || (Number.isInteger(fromYear)), 'invalid_year', 'fromYear deve ser inteiro.');
  ensure(toYear === undefined || (Number.isInteger(toYear)), 'invalid_year', 'toYear deve ser inteiro.');
  ensure(
    fromYear === undefined || toYear === undefined || fromYear <= toYear,
    'invalid_year_range',
    'fromYear não pode ser maior que toYear.',
  );
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function cloneUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneUnknown);
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneUnknown(item)]),
      );
    }
  }
  return value;
}

function cloneRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneUnknown(item)]));
}

function cloneEntity(entity: LibraryEntity): LibraryEntity {
  return {
    ...entity,
    labels: { ...entity.labels },
    aliases: [...entity.aliases],
    authorIds: [...entity.authorIds],
    regions: [...entity.regions],
    traditions: [...entity.traditions],
    disciplines: [...entity.disciplines],
    periods: [...entity.periods],
    dates: { ...entity.dates },
    locations: entity.locations.map(location => ({ ...location })),
    metadata: cloneRecord(entity.metadata),
  };
}

function cloneRelation(relation: LibraryRelation): LibraryRelation {
  return { ...relation, evidence: [...relation.evidence] };
}

function replaceReferences(entity: LibraryEntity, from: string, to: string): void {
  const replace = (values: string[]): string[] => {
    const mapped: string[] = [];
    for (const value of values) {
      const next = value === from ? to : value;
      if (!mapped.includes(next)) mapped.push(next);
    }
    return mapped;
  };
  entity.authorIds = replace(entity.authorIds);
  entity.regions = replace(entity.regions);
  entity.traditions = replace(entity.traditions);
  entity.disciplines = replace(entity.disciplines);
  entity.periods = replace(entity.periods);
}

function locationKey(location: LibraryEntity['locations'][number]): string {
  return [
    location.lat,
    location.lon,
    location.role,
    location.evidence,
    location.dates ?? '',
  ].join('\u0000');
}

export function filterLibrary(entities: LibraryEntity[], filters: LibraryFilters = {}): LibraryPage {
  validateYears(filters.fromYear, filters.toYear);
  const query = filters.query === undefined ? '' : normalize(filters.query);
  const filtered = entities.filter(entity => {
    if (filters.kinds && filters.kinds.length && !hasAny([entity.kind], filters.kinds)) return false;
    if (!hasAny(entity.regions, filters.regions)) return false;
    if (!hasAny(entity.traditions, filters.traditions)) return false;
    if (!hasAny(entity.disciplines, filters.disciplines)) return false;
    if (!hasAny(entity.periods, filters.periods)) return false;
    if (!hasAny(entity.authorIds, filters.authorIds, true)) return false;
    if (filters.language !== undefined && languageLabel(entity, filters.language) === undefined) return false;
    if (!matchesDates(entity, filters.fromYear, filters.toYear)) return false;
    if (query) {
      const haystack = [...Object.values(entity.labels), ...entity.aliases];
      if (!haystack.some(value => normalize(value).includes(query))) return false;
    }
    return true;
  });

  filtered.sort((left, right) => {
    const leftLabel = normalize(preferredLabel(left, filters.language));
    const rightLabel = normalize(preferredLabel(right, filters.language));
    const byLabel = leftLabel.localeCompare(rightLabel, 'pt', { sensitivity: 'base' });
    return byLabel !== 0 ? byLabel : left.id.localeCompare(right.id);
  });

  const { offset, limit } = pageBounds(filters.offset, filters.limit);
  return { items: filtered.slice(offset, offset + limit), total: filtered.length };
}

export function documentedLocations(entities: LibraryEntity[]): DocumentedLocation[] {
  const result: DocumentedLocation[] = [];
  for (const entity of entities) {
    for (const location of entity.locations) {
      const { lat, lon, role, evidence, dates } = location;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
      if (typeof evidence !== 'string' || !evidence.trim()) continue;
      result.push({
        entityId: entity.id,
        label: preferredLabel(entity),
        lat,
        lon,
        role,
        evidence,
        ...(dates !== undefined ? { dates } : {}),
      });
    }
  }
  return result;
}

export function graphPage(
  entities: LibraryEntity[],
  relations: LibraryRelation[],
  entityIds: string[],
  offset: number,
  limit: number,
): GraphPage {
  const bounds = pageBounds(offset, limit);
  const byId = new Map(entities.map(entity => [entity.id, entity]));
  const chosen = Array.from(new Set(entityIds));
  for (const id of chosen) {
    ensure(byId.has(id), 'unknown_entity', `Entidade inexistente: ${id}`);
  }
  const chosenSet = new Set(chosen);
  const seenNodes = new Set<string>();
  const nodes: LibraryEntity[] = [];
  for (const entity of entities) {
    if (!chosenSet.has(entity.id) || seenNodes.has(entity.id)) continue;
    seenNodes.add(entity.id);
    nodes.push(entity);
  }

  const incident = relations.filter(relation =>
    (chosenSet.has(relation.from) || chosenSet.has(relation.to)) &&
    byId.has(relation.from) &&
    byId.has(relation.to) &&
    relation.evidence.some(item => item.trim().length > 0),
  );
  const edges = incident.slice(bounds.offset, bounds.offset + bounds.limit);
  for (const edge of edges) {
    for (const id of [edge.from, edge.to]) {
      if (seenNodes.has(id)) continue;
      const endpoint = byId.get(id);
      if (endpoint) {
        seenNodes.add(id);
        nodes.push(endpoint);
      }
    }
  }
  const legend = Array.from(new Set(edges.map(relation => relation.type)));
  return { nodes, edges, total: incident.length, legend };
}

export function renameLabel(entity: LibraryEntity, language: string, label: string): LibraryEntity {
  ensure(typeof language === 'string' && language.trim().length > 0, 'invalid_language', 'Idioma obrigatório.');
  ensure(typeof label === 'string' && label.trim().length > 0, 'invalid_label', 'Rótulo obrigatório.');
  const cleaned = label.trim();
  const wanted = normaliseLanguage(language);
  const key = Object.keys(entity.labels).find(candidate => normaliseLanguage(candidate) === wanted) ?? language.trim();
  const previous = entity.labels[key];
  const aliases = [...entity.aliases];
  if (previous !== undefined && previous.trim() && previous !== cleaned && !aliases.includes(previous)) {
    aliases.push(previous);
  }
  return {
    ...cloneEntity(entity),
    labels: { ...entity.labels, [key]: cleaned },
    aliases,
  };
}

export function mergeEntities(
  entities: LibraryEntity[],
  relations: LibraryRelation[],
  fromIds: string[],
  targetId: string,
): MergeResult {
  ensure(fromIds.length > 0, 'missing_sources', 'Informe ao menos uma entidade de origem.');
  const uniqueFromIds = Array.from(new Set(fromIds));
  ensure(!uniqueFromIds.includes(targetId), 'invalid_target', 'O alvo não pode ser uma origem.');
  const byId = new Map(entities.map(entity => [entity.id, entity]));
  const target = byId.get(targetId);
  ensure(target !== undefined, 'unknown_target', `Entidade alvo inexistente: ${targetId}`);
  const sources = uniqueFromIds.map(id => {
    const source = byId.get(id);
    ensure(source !== undefined, 'unknown_entity', `Entidade inexistente: ${id}`);
    return source;
  });
  ensure(sources.every(source => source.kind === target.kind), 'kind_mismatch', 'Só é possível fundir entidades da mesma espécie.');

  const merged = cloneEntity(target);
  const priorMetadata = cloneRecord(target.metadata);
  const priorMerged = cloneRecord(priorMetadata.mergedFrom as Record<string, unknown> | undefined);
  const locationKeys = new Set(merged.locations.map(locationKey));

  for (const source of sources) {
    for (const [language, value] of Object.entries(source.labels)) {
      if (merged.labels[language] === undefined) merged.labels[language] = value;
      else if (merged.labels[language] !== value) merged.aliases.push(value);
    }
    merged.aliases.push(...source.aliases);
    merged.authorIds.push(...source.authorIds);
    merged.regions.push(...source.regions);
    merged.traditions.push(...source.traditions);
    merged.disciplines.push(...source.disciplines);
    merged.periods.push(...source.periods);
    if (merged.authorship === undefined && source.authorship !== undefined) merged.authorship = source.authorship;

    const hadDates = merged.dates.start !== null || merged.dates.end !== null;
    if (merged.dates.start === null && source.dates.start !== null) merged.dates.start = source.dates.start;
    if (merged.dates.end === null && source.dates.end !== null) merged.dates.end = source.dates.end;
    if (!merged.dates.original && source.dates.original) merged.dates.original = source.dates.original;
    if (!merged.dates.evidence && source.dates.evidence) merged.dates.evidence = source.dates.evidence;
    if (!hadDates && (source.dates.start !== null || source.dates.end !== null)) {
      merged.dates.approximate = source.dates.approximate;
    } else {
      merged.dates.approximate = merged.dates.approximate || source.dates.approximate;
    }

    for (const location of source.locations) {
      const key = locationKey(location);
      if (locationKeys.has(key)) continue;
      locationKeys.add(key);
      merged.locations.push({ ...location });
    }

    priorMerged[source.id] = {
      labels: { ...source.labels },
      aliases: [...source.aliases],
      authorIds: [...source.authorIds],
      authorship: source.authorship,
      regions: [...source.regions],
      traditions: [...source.traditions],
      disciplines: [...source.disciplines],
      periods: [...source.periods],
      dates: { ...source.dates },
      locations: source.locations.map(location => ({ ...location })),
      metadata: cloneRecord(source.metadata),
    };
  }
  merged.aliases = uniqueStrings(merged.aliases);
  merged.authorIds = uniqueStrings(merged.authorIds);
  merged.regions = uniqueStrings(merged.regions);
  merged.traditions = uniqueStrings(merged.traditions);
  merged.disciplines = uniqueStrings(merged.disciplines);
  merged.periods = uniqueStrings(merged.periods);
  merged.metadata = { ...priorMetadata, mergedFrom: priorMerged };

  const redirects: Record<string, string> = {};
  for (const id of uniqueFromIds) redirects[id] = targetId;

  const mergedEntities: LibraryEntity[] = [];
  for (const entity of entities) {
    if (uniqueFromIds.includes(entity.id)) continue;
    mergedEntities.push(entity.id === targetId ? merged : entity);
  }
  const redirectedEntities = mergedEntities.map(entity => {
    const copy = cloneEntity(entity);
    for (const id of uniqueFromIds) replaceReferences(copy, id, targetId);
    return copy;
  });

  const outputRelations: LibraryRelation[] = [];
  const byKey = new Map<string, LibraryRelation>();
  for (const relation of relations) {
    const redirect = cloneRelation(relation);
    redirect.from = redirects[redirect.from] ?? redirect.from;
    redirect.to = redirects[redirect.to] ?? redirect.to;
    if (redirect.from === redirect.to) continue;
    const key = [redirect.from, redirect.to, redirect.type].join('\u0000');
    const existing = byKey.get(key);
    if (existing) existing.evidence = uniqueStrings([...existing.evidence, ...redirect.evidence]);
    else {
      byKey.set(key, redirect);
      outputRelations.push(redirect);
    }
  }

  return { entities: redirectedEntities, relations: outputRelations, redirects };
}

export function splitEntity(
  entities: LibraryEntity[],
  relations: LibraryRelation[],
  sourceId: string,
  replacements: LibraryEntity[],
  assignments: Record<string, string>,
): SplitResult {
  const source = entities.find(entity => entity.id === sourceId);
  ensure(source !== undefined, 'unknown_source', `Entidade de origem inexistente: ${sourceId}`);
  ensure(replacements.length > 0, 'missing_replacements', 'Informe ao menos uma entidade substituta.');

  const existingIds = new Set(entities.map(entity => entity.id));
  const newIds = new Set<string>();
  for (const replacement of replacements) {
    ensure(!existingIds.has(replacement.id), 'duplicate_id', `Id já existente: ${replacement.id}`);
    ensure(!newIds.has(replacement.id), 'duplicate_id', `Id substituto repetido: ${replacement.id}`);
    ensure(replacement.kind === source.kind, 'kind_mismatch', 'Substitutos devem ter a mesma espécie da origem.');
    newIds.add(replacement.id);
  }

  const dependentEntityIds = new Set(
    entities
      .filter(entity => entity.id !== sourceId)
      .filter(entity => REFERENCE_FIELDS.some(field => entity[field].includes(sourceId)))
      .map(entity => entity.id),
  );
  for (const replacement of replacements) {
    if (REFERENCE_FIELDS.some(field => replacement[field].includes(sourceId))) {
      dependentEntityIds.add(replacement.id);
    }
  }
  const dependentRelationIds = new Set(
    relations.filter(relation => relation.from === sourceId || relation.to === sourceId).map(relation => relation.id),
  );
  const destinationFor = (dependentId: string): string => {
    const destination = assignments[dependentId];
    ensure(
      typeof destination === 'string' && newIds.has(destination),
      'missing_split_assignment',
      `Dependência sem destino explícito válido: ${dependentId}`,
    );
    return destination;
  };
  for (const id of dependentEntityIds) destinationFor(id);
  for (const id of dependentRelationIds) destinationFor(id);

  const replacementEntities = replacements.map(replacement => {
    const clone = cloneEntity(replacement);
    if (dependentEntityIds.has(replacement.id)) {
      replaceReferences(clone, sourceId, destinationFor(replacement.id));
    }
    clone.metadata = { ...clone.metadata, splitFrom: sourceId };
    return clone;
  });

  const outputEntities: LibraryEntity[] = [];
  for (const entity of entities) {
    if (entity.id === sourceId) {
      outputEntities.push(...replacementEntities);
      continue;
    }
    if (!dependentEntityIds.has(entity.id)) {
      outputEntities.push(entity);
      continue;
    }
    const clone = cloneEntity(entity);
    replaceReferences(clone, sourceId, destinationFor(entity.id));
    outputEntities.push(clone);
  }

  const outputRelations = relations.map(relation => {
    if (relation.from !== sourceId && relation.to !== sourceId) return cloneRelation(relation);
    const clone = cloneRelation(relation);
    const destination = destinationFor(relation.id);
    if (clone.from === sourceId) clone.from = destination;
    if (clone.to === sourceId) clone.to = destination;
    return clone;
  });

  return { entities: outputEntities, relations: outputRelations };
}
