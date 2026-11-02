import test from 'node:test';
import assert from 'node:assert/strict';

import {
  codePointToUtf16,
  codePoints,
  reanchor,
  selectionMatches,
  utf16ToCodePoint,
  validateAnchor,
  validateLinks,
} from '../src/anchors.ts';
import { AppError } from '../src/errors.ts';
import type { Anchor, DocumentLink, SourceBlock } from '../src/contracts.ts';

const ORIGINAL = '11111111-1111-4111-8111-111111111111';
const TRANSLATION = '22222222-2222-4222-8222-222222222222';

function block(id: string, text: string): SourceBlock {
  return { id, kind: 'paragraph', text, meta: {} };
}

function anchor(input: {
  sourceId: string;
  sourceRevision: number;
  elementId: string;
  start: number;
  end: number;
  exact: string;
  prefix?: string;
  suffix?: string;
  locator?: string;
}): Anchor {
  return {
    sourceId: input.sourceId,
    sourceRevision: input.sourceRevision,
    elementId: input.elementId,
    start: input.start,
    end: input.end,
    exact: input.exact,
    prefix: input.prefix ?? '',
    suffix: input.suffix ?? '',
    ...(input.locator === undefined ? {} : { locator: input.locator }),
  };
}

function findSubsequence(haystack: string[], needle: string[]): number {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matches = true;
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return start;
  }
  return -1;
}

function anchorAt(
  sourceId: string,
  sourceRevision: number,
  elementId: string,
  text: string,
  exact: string,
  prefix = '',
  suffix = '',
): Anchor {
  const points = codePoints(text);
  const prefixPoints = codePoints(prefix);
  const exactPoints = codePoints(exact);
  const context = [...prefixPoints, ...exactPoints, ...codePoints(suffix)].join('');
  const start = findSubsequence(points, codePoints(context));
  assert.notEqual(start, -1, 'contexto do teste não encontrado');
  const exactStart = start + prefixPoints.length;
  return anchor({
    sourceId,
    sourceRevision,
    elementId,
    start: exactStart,
    end: exactStart + exactPoints.length,
    exact,
    prefix,
    suffix,
  });
}

function throwsCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof AppError && error.code === code);
}

test('codePoints usa pontos de código, preserva RTL e não normaliza', () => {
  const polytonic = 'ἄνθρωπος';
  const arabic = 'مَرْحَبًا';
  const emoji = '👩🏽‍🚀';

  assert.deepEqual(codePoints(polytonic), Array.from(polytonic));
  assert.deepEqual(codePoints(arabic), Array.from(arabic));
  assert.equal(codePoints('漢字').length, 2);
  assert.equal(codePoints('😀').length, 1);
  assert.deepEqual(codePoints(emoji), Array.from(emoji));
  assert.equal(codePoints('e\u0301').length, 2);
  assert.equal(codePoints('é').length, 1);
  assert.notDeepEqual(codePoints('e\u0301'), codePoints('é'));
});

test('utf16ToCodePoint e codePointToUtf16 são inversas e rejeitam meio de surrogate', () => {
  const text = 'a😀b';
  assert.equal(text.length, 4);

  assert.equal(utf16ToCodePoint(text, 0), 0);
  assert.equal(utf16ToCodePoint(text, 1), 1);
  throwsCode(() => utf16ToCodePoint(text, 2), 'ANCHOR_SURROGATE_SPLIT');
  assert.equal(utf16ToCodePoint(text, 3), 2);
  assert.equal(utf16ToCodePoint(text, 4), 3);

  assert.equal(codePointToUtf16(text, 0), 0);
  assert.equal(codePointToUtf16(text, 1), 1);
  assert.equal(codePointToUtf16(text, 2), 3);
  assert.equal(codePointToUtf16(text, 3), 4);

  for (let offset = 0; offset <= codePoints(text).length; offset += 1) {
    assert.equal(utf16ToCodePoint(text, codePointToUtf16(text, offset)), offset);
  }

  throwsCode(() => utf16ToCodePoint(text, -1), 'ANCHOR_INVALID_OFFSET');
  throwsCode(() => utf16ToCodePoint(text, text.length + 1), 'ANCHOR_INVALID_OFFSET');
  throwsCode(() => utf16ToCodePoint(text, 1.5), 'ANCHOR_INVALID_OFFSET');
  throwsCode(() => codePointToUtf16(text, -1), 'ANCHOR_INVALID_OFFSET');
  throwsCode(() => codePointToUtf16(text, codePoints(text).length + 1), 'ANCHOR_INVALID_OFFSET');
  throwsCode(() => codePointToUtf16(text, 0.5), 'ANCHOR_INVALID_OFFSET');

  assert.equal(utf16ToCodePoint('\uD800', 1), 1);
  assert.equal(codePointToUtf16('\uD800', 1), 1);
});

test('validateAnchor valida identidade, revisão, bloco, intervalo, exact e contexto', () => {
  const greekText = 'ἄνθρωπος λόγος';
  const source = { id: ORIGINAL, revision: 1, blocks: [block('greek', greekText)] };
  const valid = anchorAt(ORIGINAL, 1, 'greek', greekText, 'λόγος', 'ἄνθρωπος ');

  assert.doesNotThrow(() => validateAnchor(valid, source));
  throwsCode(() => validateAnchor({ ...valid, sourceId: TRANSLATION }, source), 'ANCHOR_SOURCE_MISMATCH');
  throwsCode(() => validateAnchor({ ...valid, sourceRevision: 2 }, source), 'ANCHOR_REVISION_MISMATCH');
  throwsCode(() => validateAnchor({ ...valid, elementId: 'missing' }, source), 'ANCHOR_BLOCK_NOT_FOUND');
  throwsCode(() => validateAnchor({ ...valid, start: -1 }, source), 'ANCHOR_INVALID_RANGE');
  throwsCode(() => validateAnchor({ ...valid, end: valid.start }, source), 'ANCHOR_INVALID_RANGE');
  throwsCode(() => validateAnchor({ ...valid, start: valid.start - 1 }, source), 'ANCHOR_EXACT_MISMATCH');
  throwsCode(() => validateAnchor({ ...valid, exact: 'ΛΟΓΟΣ' }, source), 'ANCHOR_EXACT_MISMATCH');
  throwsCode(() => validateAnchor({ ...valid, prefix: 'λόγος ' }, source), 'ANCHOR_PREFIX_MISMATCH');
  throwsCode(() => validateAnchor({ ...valid, suffix: 'x' }, source), 'ANCHOR_SUFFIX_MISMATCH');
});

test('validateAnchor usa offsets em pontos de código e não mistura traduções', () => {
  const greekText = 'ἄνθρωπος λόγος';
  const arabicText = 'مَرْحَبًا';
  const source = {
    id: ORIGINAL,
    revision: 1,
    blocks: [block('greek', greekText), block('emoji', 'a😀b'), block('arabic', arabicText), block('cjk', '漢字')],
  };

  const emoji = anchor({
    sourceId: ORIGINAL,
    sourceRevision: 1,
    elementId: 'emoji',
    start: 1,
    end: 2,
    exact: '😀',
    prefix: 'a',
    suffix: 'b',
  });
  assert.doesNotThrow(() => validateAnchor(emoji, source));

  const arabic = anchor({
    sourceId: ORIGINAL,
    sourceRevision: 1,
    elementId: 'arabic',
    start: 0,
    end: 2,
    exact: codePoints(arabicText).slice(0, 2).join(''),
  });
  assert.doesNotThrow(() => validateAnchor(arabic, source));
  assert.doesNotThrow(() => validateAnchor(anchor({
    sourceId: ORIGINAL,
    sourceRevision: 1,
    elementId: 'cjk',
    start: 0,
    end: 2,
    exact: '漢字',
  }), source));

  const translation = { id: TRANSLATION, revision: 1, blocks: [block('greek', greekText)] };
  const translationAnchor = anchorAt(TRANSLATION, 1, 'greek', greekText, 'λόγος', 'ἄνθρωπος ');
  assert.doesNotThrow(() => validateAnchor(translationAnchor, translation));
  throwsCode(() => validateAnchor(translationAnchor, source), 'ANCHOR_SOURCE_MISMATCH');
  throwsCode(
    () => validateAnchor(anchorAt(ORIGINAL, 1, 'greek', greekText, 'λόγος', 'ἄνθρωπος '), translation),
    'ANCHOR_SOURCE_MISMATCH',
  );
});

test('selectionMatches exige mesma fonte/revisão/bloco e preserva ambiguidades', () => {
  const greekText = 'ἄνθρωπος λόγος';
  const selection = anchorAt(ORIGINAL, 1, 'greek', greekText, 'λόγος');
  const exactTarget = anchorAt(ORIGINAL, 1, 'greek', greekText, 'λόγος');
  const containingTarget = anchorAt(ORIGINAL, 1, 'greek', greekText, ' λόγος');
  const adjacentTarget = anchorAt(ORIGINAL, 1, 'greek', greekText, 'πος ');
  const overlappingTarget = anchorAt(ORIGINAL, 1, 'greek', greekText, ' λόγ');
  const otherBlockTarget = anchorAt(ORIGINAL, 1, 'other', 'outro texto', 'outro');
  const otherRevisionTarget = { ...exactTarget, sourceRevision: 2 };
  const otherSourceTarget = { ...exactTarget, sourceId: TRANSLATION };

  const matches = selectionMatches(selection, [
    { id: 'exact', targets: [exactTarget] },
    { id: 'contains', targets: [containingTarget] },
    { id: 'multiple', targets: [otherBlockTarget, overlappingTarget, containingTarget] },
    { id: 'other-block', targets: [otherBlockTarget] },
    { id: 'other-revision', targets: [otherRevisionTarget] },
    { id: 'other-source', targets: [otherSourceTarget] },
    { id: 'adjacent', targets: [adjacentTarget] },
    { id: 'overlap', targets: [overlappingTarget] },
    { id: 'ambiguous-a', targets: [exactTarget] },
    { id: 'ambiguous-b', targets: [containingTarget] },
  ]);

  assert.deepEqual(matches.map((match) => [match.id, match.match]), [
    ['exact', 'exact'],
    ['contains', 'contains'],
    ['multiple', 'contains'],
    ['ambiguous-a', 'exact'],
    ['ambiguous-b', 'contains'],
  ]);
  assert.equal(matches[0].target, exactTarget);
});

test('reanchor valida a mesma revisão e não aceita sucesso cego', () => {
  const greekText = 'ἄνθρωπος λόγος';
  const source = { id: ORIGINAL, revision: 1, blocks: [block('greek', greekText)] };
  const valid = anchorAt(ORIGINAL, 1, 'greek', greekText, 'λόγος', 'ἄνθρωπος ');

  const verified = reanchor(valid, source);
  assert.equal(verified.status, 'verified');
  if (verified.status === 'verified') assert.equal(verified.anchor, valid);

  const invalid = { ...valid, exact: 'ΛΟΓΟΣ' };
  const review = reanchor(invalid, source);
  assert.equal(review.status, 'needs_review');
  if (review.status === 'needs_review') {
    assert.equal(review.previous, invalid);
    assert.ok(review.reason.length > 0);
  }

  const otherSource = reanchor({ ...valid, sourceId: TRANSLATION }, source);
  assert.equal(otherSource.status, 'needs_review');
});

test('reanchor encontra correspondência única contextual na nova revisão', () => {
  const oldText = 'πρῶτος λόγος ἀρχή';
  const oldAnchor = anchorAt(ORIGINAL, 1, 'greek', oldText, 'λόγος', 'πρῶτος ', ' ἀρχή');
  const newText = 'Introdução: πρῶτος λόγος ἀρχή final.';
  const newSource = { id: ORIGINAL, revision: 2, blocks: [block('greek', newText)] };

  const result = reanchor(oldAnchor, newSource);
  assert.equal(result.status, 'verified');
  if (result.status === 'verified') {
    assert.equal(result.anchor.sourceRevision, 2);
    assert.equal(result.anchor.elementId, 'greek');
    assert.equal(result.anchor.exact, 'λόγος');
    assert.equal(result.anchor.prefix, 'πρῶτος ');
    assert.equal(result.anchor.suffix, ' ἀρχή');

    const expected = anchorAt(ORIGINAL, 2, 'greek', newText, 'λόγος', 'πρῶτος ', ' ἀρχή');
    assert.equal(result.anchor.start, expected.start);
    assert.equal(result.anchor.end, expected.end);
    assert.doesNotThrow(() => validateAnchor(result.anchor, newSource));
  }
});

test('reanchor usa contexto único, mas preserva a âncora em ambiguidade ou ausência', () => {
  const oldText = 'πρῶτος λόγος ἀρχή · δεύτερος λόγος τέλος';
  const oldAnchor = anchorAt(ORIGINAL, 1, 'greek', oldText, 'λόγος', 'πρῶτος ', ' ἀρχή');
  const newText = 'x πρῶτος λόγος ἀρχή · δεύτερος λόγος τέλος y';
  const newSource = { id: ORIGINAL, revision: 2, blocks: [block('greek', newText)] };

  const contextual = reanchor(oldAnchor, newSource);
  assert.equal(contextual.status, 'verified');
  if (contextual.status === 'verified') {
    const expected = anchorAt(ORIGINAL, 2, 'greek', newText, 'λόγος', 'πρῶτος ', ' ἀρχή');
    assert.equal(contextual.anchor.start, expected.start);
  }

  const ambiguous = reanchor(anchorAt(ORIGINAL, 1, 'greek', 'λόγος', 'λόγος'), {
    id: ORIGINAL,
    revision: 2,
    blocks: [block('greek', 'λόγος e λόγος')],
  });
  assert.equal(ambiguous.status, 'needs_review');
  if (ambiguous.status === 'needs_review') assert.equal(ambiguous.previous.exact, 'λόγος');

  const missing = reanchor(anchorAt(ORIGINAL, 1, 'greek', 'λόγος', 'λόγος'), {
    id: ORIGINAL,
    revision: 2,
    blocks: [block('greek', 'ἄνθρωπος')],
  });
  assert.equal(missing.status, 'needs_review');

  const missingBlock = reanchor(anchorAt(ORIGINAL, 1, 'greek', 'λόγος', 'λόγος'), {
    id: ORIGINAL,
    revision: 2,
    blocks: [block('other', 'λόγος')],
  });
  assert.equal(missingBlock.status, 'needs_review');
});

test('reanchor não normaliza diacríticos', () => {
  const composed = anchorAt(ORIGINAL, 1, 'greek', 'ἄ', 'ἄ');
  const decomposedSource = {
    id: ORIGINAL,
    revision: 2,
    blocks: [block('greek', 'α\u0313\u0301')],
  };
  const result = reanchor(composed, decomposedSource);
  assert.equal(result.status, 'needs_review');
});

test('validateLinks verifica todos os destinos, várias fontes e tipos declarados', () => {
  const original = {
    id: ORIGINAL,
    revision: 1,
    blocks: [block('greek', 'ἄνθρωπος λόγος'), block('cjk', '漢字')],
  };
  const translation = {
    id: TRANSLATION,
    revision: 1,
    blocks: [block('greek', 'homem palavra')],
  };
  const originalAnchor = anchorAt(ORIGINAL, 1, 'greek', 'ἄνθρωπος λόγος', 'λόγος');
  const cjkAnchor = anchorAt(ORIGINAL, 1, 'cjk', '漢字', '漢字');
  const translationAnchor = anchorAt(TRANSLATION, 1, 'greek', 'homem palavra', 'palavra');

  const link = (id: string, from: Anchor[], to: Anchor[], relation: DocumentLink['relation']): DocumentLink => ({
    id,
    from,
    to,
    relation,
    provenance: { kind: 'source', references: [], limitations: [] },
  });

  assert.doesNotThrow(() => validateLinks([
    link('many', [originalAnchor, cjkAnchor], [translationAnchor], 'interprets'),
  ], [original, translation]));

  throwsCode(() => validateLinks([
    link('invalid-relation', [originalAnchor], [translationAnchor], 'mentions' as DocumentLink['relation']),
  ], [original, translation]), 'LINK_INVALID_RELATION');

  throwsCode(() => validateLinks([
    link('unknown-source', [originalAnchor], [{ ...translationAnchor, sourceId: 'missing' }], 'supports'),
  ], [original, translation]), 'LINK_UNKNOWN_SOURCE');

  throwsCode(() => validateLinks([
    link('invalid-anchor', [{ ...originalAnchor, exact: 'ΛΟΓΟΣ' }], [translationAnchor], 'contrasts'),
  ], [original, translation]), 'ANCHOR_EXACT_MISMATCH');
});
