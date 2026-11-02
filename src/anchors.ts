// Adaptação conceitual de AraRead, MIT, Copyright (c) 2026 Fabio Ara.
// Reaproveita Array.from para pontos de código, intervalos semiabertos e a
// identidade fonte+elemento, sem herdar segmentação por tamanho nem chamadas
// legadas do leitor.

import { ensure } from './errors.ts';
import type { Anchor, DocumentLink, SourceBlock } from './contracts.ts';

type SourceView = { id: string; revision: number; blocks: SourceBlock[] };
type SelectionResource = { id: string; targets: Anchor[] };
type SelectionMatch = { id: string; target: Anchor; match: 'exact' | 'contains' };

export type ReanchorResult =
  | { status: 'verified'; anchor: Anchor }
  | { status: 'needs_review'; previous: Anchor; reason: string };

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Divide o texto em pontos de código, exatamente como Array.from. */
export function codePoints(text: string): string[] {
  ensure(typeof text === 'string', 'ANCHOR_INVALID_TEXT', 'Texto deve ser uma string.');
  return Array.from(text);
}

/** Converte um limite UTF-16 em limite de pontos de código, sem normalizar. */
export function utf16ToCodePoint(text: string, offset: number): number {
  ensure(typeof text === 'string', 'ANCHOR_INVALID_TEXT', 'Texto deve ser uma string.');
  ensure(Number.isInteger(offset), 'ANCHOR_INVALID_OFFSET', 'Offset UTF-16 deve ser inteiro.');
  ensure(offset >= 0 && offset <= text.length, 'ANCHOR_INVALID_OFFSET', 'Offset UTF-16 fora dos limites do texto.');

  if (offset > 0 && offset < text.length) {
    const previous = text.charCodeAt(offset - 1);
    const next = text.charCodeAt(offset);
    ensure(
      !(isHighSurrogate(previous) && isLowSurrogate(next)),
      'ANCHOR_SURROGATE_SPLIT',
      'Offset UTF-16 no meio de um par surrogate.',
    );
  }

  let index = 0;
  let codePointOffset = 0;
  while (index < offset) {
    const first = text.charCodeAt(index);
    const width = isHighSurrogate(first)
      && index + 1 < text.length
      && isLowSurrogate(text.charCodeAt(index + 1))
      ? 2
      : 1;
    index += width;
    codePointOffset += 1;
  }

  ensure(index === offset, 'ANCHOR_SURROGATE_SPLIT', 'Offset UTF-16 no meio de um par surrogate.');
  return codePointOffset;
}

/** Converte um limite de pontos de código em limite UTF-16; inversa exata. */
export function codePointToUtf16(text: string, offset: number): number {
  ensure(typeof text === 'string', 'ANCHOR_INVALID_TEXT', 'Texto deve ser uma string.');
  ensure(Number.isInteger(offset), 'ANCHOR_INVALID_OFFSET', 'Offset de ponto de código deve ser inteiro.');
  const points = codePoints(text);
  ensure(offset >= 0 && offset <= points.length, 'ANCHOR_INVALID_OFFSET', 'Offset de ponto de código fora dos limites do texto.');

  let utf16Offset = 0;
  for (let index = 0; index < offset; index += 1) {
    utf16Offset += points[index].length;
  }
  return utf16Offset;
}

function findBlock(source: SourceView, elementId: string): SourceBlock {
  ensure(
    source && typeof source === 'object' && Array.isArray(source.blocks),
    'ANCHOR_INVALID_SOURCE',
    'Fonte inválida.',
  );
  const matches = source.blocks.filter((block) => block && block.id === elementId);
  ensure(matches.length > 0, 'ANCHOR_BLOCK_NOT_FOUND', `Bloco não encontrado: ${elementId}.`);
  ensure(matches.length === 1, 'ANCHOR_BLOCK_AMBIGUOUS', `Bloco ambíguo: ${elementId}.`);
  return matches[0];
}

/** Valida uma âncora contra uma única fonte, sem misturar traduções. */
export function validateAnchor(anchor: Anchor, source: SourceView): void {
  ensure(anchor && typeof anchor === 'object', 'ANCHOR_INVALID', 'Âncora inválida.');
  ensure(
    source && typeof source === 'object' && typeof source.id === 'string',
    'ANCHOR_INVALID_SOURCE',
    'Fonte inválida.',
  );
  ensure(anchor.sourceId === source.id, 'ANCHOR_SOURCE_MISMATCH', 'Âncora pertence a outra fonte.');
  ensure(anchor.sourceRevision === source.revision, 'ANCHOR_REVISION_MISMATCH', 'Âncora pertence a outra revisão.');
  ensure(
    typeof anchor.elementId === 'string' && anchor.elementId.length > 0,
    'ANCHOR_INVALID_ELEMENT',
    'Elemento da âncora obrigatório.',
  );

  const block = findBlock(source, anchor.elementId);

  ensure(Number.isInteger(anchor.start), 'ANCHOR_INVALID_RANGE', 'Início deve ser inteiro.');
  ensure(Number.isInteger(anchor.end), 'ANCHOR_INVALID_RANGE', 'Fim deve ser inteiro.');
  ensure(anchor.start >= 0, 'ANCHOR_INVALID_RANGE', 'Início não pode ser negativo.');
  ensure(anchor.end > 0, 'ANCHOR_INVALID_RANGE', 'Fim deve ser positivo.');
  ensure(anchor.end > anchor.start, 'ANCHOR_INVALID_RANGE', 'Intervalo vazio ou invertido.');
  ensure(
    typeof anchor.exact === 'string' && anchor.exact.length > 0,
    'ANCHOR_INVALID_EXACT',
    'Texto exato da âncora obrigatório.',
  );

  const points = codePoints(block.text);
  ensure(anchor.end <= points.length, 'ANCHOR_INVALID_RANGE', 'Intervalo excede o texto do bloco.');
  ensure(
    points.slice(anchor.start, anchor.end).join('') === anchor.exact,
    'ANCHOR_EXACT_MISMATCH',
    'Texto exato não corresponde ao intervalo.',
  );

  const prefix = anchor.prefix ?? '';
  ensure(typeof prefix === 'string', 'ANCHOR_INVALID_PREFIX', 'Prefixo deve ser string.');
  if (prefix.length > 0) {
    const prefixPoints = codePoints(prefix);
    ensure(anchor.start >= prefixPoints.length, 'ANCHOR_PREFIX_MISMATCH', 'Prefixo não cabe antes do intervalo.');
    ensure(
      points.slice(anchor.start - prefixPoints.length, anchor.start).join('') === prefix,
      'ANCHOR_PREFIX_MISMATCH',
      'Prefixo não corresponde ao texto anterior.',
    );
  }

  const suffix = anchor.suffix ?? '';
  ensure(typeof suffix === 'string', 'ANCHOR_INVALID_SUFFIX', 'Sufixo deve ser string.');
  if (suffix.length > 0) {
    const suffixPoints = codePoints(suffix);
    ensure(
      anchor.end + suffixPoints.length <= points.length,
      'ANCHOR_SUFFIX_MISMATCH',
      'Sufixo não cabe depois do intervalo.',
    );
    ensure(
      points.slice(anchor.end, anchor.end + suffixPoints.length).join('') === suffix,
      'ANCHOR_SUFFIX_MISMATCH',
      'Sufixo não corresponde ao texto posterior.',
    );
  }
}

/**
 * Casamento por identidade fonte/revisão/bloco e contenção semiaberta.
 * Retorna todos os alvos, inclusive duplicados, sem escolher proximidade.
 */
export function selectionMatches(selection: Anchor, resources: SelectionResource[]): SelectionMatch[] {
  ensure(selection && typeof selection === 'object', 'ANCHOR_INVALID', 'Seleção inválida.');
  ensure(Array.isArray(resources), 'ANCHOR_INVALID_RESOURCES', 'Recursos inválidos.');

  const matches: SelectionMatch[] = [];
  for (const resource of resources) {
    ensure(
      resource && typeof resource === 'object' && Array.isArray(resource.targets),
      'ANCHOR_INVALID_RESOURCE',
      'Recurso inválido.',
    );
    for (const target of resource.targets) {
      ensure(target && typeof target === 'object', 'ANCHOR_INVALID_TARGET', 'Alvo inválido.');
      if (target.sourceId !== selection.sourceId) continue;
      if (target.sourceRevision !== selection.sourceRevision) continue;
      if (target.elementId !== selection.elementId) continue;
      if (target.start > selection.start || target.end < selection.end) continue;

      const exact = target.start === selection.start
        && target.end === selection.end
        && target.exact === selection.exact;
      matches.push({ id: resource.id, target, match: exact ? 'exact' : 'contains' });
    }
  }
  return matches;
}

function needsReview(previous: Anchor, reason: string): ReanchorResult {
  return { status: 'needs_review', previous, reason };
}

function describeError(error: unknown, fallback: string): string {
  if (
    error
    && typeof error === 'object'
    && 'message' in error
    && typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

function contextualMatches(block: SourceBlock, anchor: Anchor): { start: number; end: number }[] {
  const exactPoints = codePoints(anchor.exact);
  const prefixPoints = codePoints(anchor.prefix ?? '');
  const suffixPoints = codePoints(anchor.suffix ?? '');
  const points = codePoints(block.text);
  const matches: { start: number; end: number }[] = [];

  for (let start = 0; start + exactPoints.length <= points.length; start += 1) {
    let exact = true;
    for (let index = 0; index < exactPoints.length; index += 1) {
      if (points[start + index] !== exactPoints[index]) {
        exact = false;
        break;
      }
    }
    if (!exact) continue;

    const end = start + exactPoints.length;
    if (start < prefixPoints.length || end + suffixPoints.length > points.length) continue;

    let prefix = true;
    for (let index = 0; index < prefixPoints.length; index += 1) {
      if (points[start - prefixPoints.length + index] !== prefixPoints[index]) {
        prefix = false;
        break;
      }
    }
    if (!prefix) continue;

    let suffix = true;
    for (let index = 0; index < suffixPoints.length; index += 1) {
      if (points[end + index] !== suffixPoints[index]) {
        suffix = false;
        break;
      }
    }
    if (!suffix) continue;

    matches.push({ start, end });
  }
  return matches;
}

/**
 * Reancora de forma conservadora. Mantém a identidade fonte+elemento, não usa
 * a posição antiga como prova, não normaliza diacríticos e exige contexto único.
 */
export function reanchor(anchor: Anchor, source: SourceView): ReanchorResult {
  if (!anchor || typeof anchor !== 'object') {
    return needsReview(anchor, 'Âncora inválida.');
  }
  if (!source || typeof source !== 'object' || typeof source.id !== 'string') {
    return needsReview(anchor, 'Fonte inválida.');
  }
  if (anchor.sourceId !== source.id) {
    return needsReview(
      anchor,
      'A âncora pertence a outra fonte; reancoragem entre fontes ou traduções não é permitida.',
    );
  }

  if (anchor.sourceRevision === source.revision) {
    try {
      validateAnchor(anchor, source);
      return { status: 'verified', anchor };
    } catch (error) {
      return needsReview(anchor, describeError(error, 'A âncora não corresponde à fonte na mesma revisão.'));
    }
  }

  try {
    ensure(
      typeof anchor.exact === 'string' && anchor.exact.length > 0,
      'ANCHOR_INVALID_EXACT',
      'Texto exato da âncora obrigatório.',
    );
    ensure(
      typeof anchor.elementId === 'string' && anchor.elementId.length > 0,
      'ANCHOR_INVALID_ELEMENT',
      'Elemento da âncora obrigatório.',
    );
    const block = findBlock(source, anchor.elementId);
    const matches = contextualMatches(block, anchor);

    if (matches.length === 0) {
      return needsReview(anchor, 'Correspondência exata contextual ausente no bloco da nova revisão.');
    }
    if (matches.length > 1) {
      return needsReview(anchor, 'Correspondência exata contextual ambígua no bloco da nova revisão.');
    }

    const next: Anchor = {
      ...anchor,
      sourceRevision: source.revision,
      start: matches[0].start,
      end: matches[0].end,
      exact: anchor.exact,
      prefix: anchor.prefix ?? '',
      suffix: anchor.suffix ?? '',
    };
    validateAnchor(next, source);
    return { status: 'verified', anchor: next };
  } catch (error) {
    return needsReview(anchor, describeError(error, 'Não foi possível reancorar com segurança.'));
  }
}

const DECLARED_RELATIONS = new Set<DocumentLink['relation']>([
  'supports',
  'interprets',
  'contrasts',
  'illustrates',
]);

/** Verifica todos os destinos, as relações declaradas e o mapeamento fonte a fonte. */
export function validateLinks(links: DocumentLink[], sources: SourceView[]): void {
  ensure(Array.isArray(links), 'LINK_INVALID_LINKS', 'Lista de links inválida.');
  ensure(Array.isArray(sources), 'LINK_INVALID_SOURCES', 'Lista de fontes inválida.');

  const byId = new Map<string, SourceView>();
  for (const source of sources) {
    ensure(
      source && typeof source === 'object' && typeof source.id === 'string',
      'LINK_INVALID_SOURCE',
      'Fonte inválida.',
    );
    ensure(!byId.has(source.id), 'LINK_AMBIGUOUS_SOURCE', `Fonte duplicada: ${source.id}.`);
    byId.set(source.id, source);
  }

  for (const link of links) {
    ensure(link && typeof link === 'object', 'LINK_INVALID_LINK', 'Link inválido.');
    ensure(
      DECLARED_RELATIONS.has(link.relation),
      'LINK_INVALID_RELATION',
      `Relação não declarada: ${String(link.relation)}.`,
    );
    ensure(
      Array.isArray(link.from) && Array.isArray(link.to),
      'LINK_INVALID_ENDPOINTS',
      'Extremidades do link inválidas.',
    );

    for (const anchor of [...link.from, ...link.to]) {
      ensure(anchor && typeof anchor === 'object', 'LINK_INVALID_ANCHOR', 'Âncora de link inválida.');
      const source = byId.get(anchor.sourceId);
      ensure(source, 'LINK_UNKNOWN_SOURCE', `Fonte desconhecida: ${anchor.sourceId}.`);
      validateAnchor(anchor, source);
    }
  }
}
