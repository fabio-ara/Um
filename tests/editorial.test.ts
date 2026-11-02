import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Anchor, Attempt, CatalogEntry, Choice, ContentBundle, Coverage, Resource, StudyUnit } from '../src/contracts.ts';
import { effectiveCatalog, makeAttempt, repeatChoices, validateBundle, validateChoice } from '../src/editorial.ts';

const anchor: Anchor = {
  sourceId: '00000000-0000-4000-8000-000000000001',
  sourceRevision: 1,
  elementId: 'p1',
  start: 0,
  end: 5,
  exact: 'texto',
  prefix: '',
  suffix: '',
};

function hasCode(expected: string) {
  return (error: unknown) => error instanceof Error && (error as { code?: string }).code === expected;
}

function makeChoice(overrides: Partial<Choice> = {}): Choice {
  const base: Choice = {
    id: 'choice-1',
    revision: 1,
    unitId: 'unit-1',
    profileId: 'profile-1',
    position: 1,
    prompt: 'Qual é a resposta?',
    options: [
      { id: 'a', text: 'Alternativa A', feedback: 'Correta.' },
      { id: 'b', text: 'Alternativa B', feedback: 'Incorreta.' },
    ],
    correctOptionId: 'a',
    coverageTargets: ['coverage-1'],
    sources: [anchor],
  };
  return { ...base, ...overrides };
}

function attemptFor(question: Choice, overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: `attempt-${question.id}`,
    profileId: question.profileId,
    questionId: question.id,
    questionRevision: question.revision,
    sequenceId: 'seq-1',
    optionId: question.correctOptionId,
    correct: true,
    snapshot: JSON.parse(JSON.stringify(question)) as Choice,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeUnit(overrides: Partial<StudyUnit> = {}): StudyUnit {
  return {
    id: 'unit-1',
    title: 'Unidade 1',
    body: 'Conteúdo',
    references: [],
    knowledgeTargets: ['target-1'],
    provenance: [],
    ...overrides,
  };
}

function makeCoverage(overrides: Partial<Coverage> = {}): Coverage {
  return {
    id: 'coverage-1',
    description: 'Cobertura',
    unitIds: ['unit-1'],
    sourceAnchors: [anchor],
    practiceIds: [],
    ...overrides,
  };
}

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 'resource-1',
    projectId: 'project-1',
    baseRevision: 1,
    profileId: null,
    type: 'explanation',
    title: 'Explicação',
    purpose: 'Explicar',
    targets: [anchor],
    body: 'Texto',
    sources: [anchor],
    appliedConfiguration: {},
    inspection: 'ai_inspected',
    ...overrides,
  };
}

function makeCommonBundle(overrides: Partial<ContentBundle> = {}): ContentBundle {
  return {
    projectId: 'project-1',
    revision: 2,
    profileId: null,
    baseRevision: 0,
    units: [makeUnit()],
    resources: [makeResource()],
    choices: [],
    coverage: [makeCoverage()],
    inspection: { kind: 'ai', references: ['inspection-1'], findings: [], completed: true },
    ...overrides,
  };
}

function makePersonalBundle(overrides: Partial<ContentBundle> = {}): ContentBundle {
  return {
    projectId: 'project-1',
    revision: 3,
    profileId: 'profile-1',
    baseRevision: 2,
    units: [],
    resources: [makeResource({ profileId: 'profile-1', baseRevision: 2 })],
    choices: [makeChoice()],
    coverage: [makeCoverage({ practiceIds: ['choice-1'] })],
    inspection: { kind: 'ai', references: ['inspection-1'], findings: [], completed: true },
    ...overrides,
  };
}

test('validateChoice aceita escolha coerente e não inventa revisão humana', () => {
  const question = makeChoice();
  const before = JSON.stringify(question);
  assert.doesNotThrow(() => validateChoice(question));
  assert.equal(JSON.stringify(question), before);
  assert.equal('reviewed' in question, false);
});

test('validateChoice recusa alternativas, enunciados, feedback, perfil e fontes inválidos', () => {
  assert.throws(() => validateChoice(makeChoice({ options: [{ id: 'a', text: 'A', feedback: 'ok' }] })), hasCode('CHOICE_OPTIONS'));
  assert.throws(
    () => validateChoice(makeChoice({
      options: [
        { id: 'a', text: 'A', feedback: 'ok' },
        { id: 'a', text: 'B', feedback: 'ok' },
      ],
    })),
    hasCode('CHOICE_OPTIONS'),
  );
  assert.throws(
    () => validateChoice(makeChoice({
      options: [
        { id: 'a', text: 'A', feedback: '' },
        { id: 'b', text: 'B', feedback: 'ok' },
      ],
    })),
    hasCode('CHOICE_OPTION_FEEDBACK'),
  );
  assert.throws(() => validateChoice(makeChoice({ prompt: '  ' })), hasCode('CHOICE_PROMPT'));
  assert.throws(() => validateChoice(makeChoice({ correctOptionId: 'z' })), hasCode('CHOICE_CORRECT'));
  assert.throws(() => validateChoice(makeChoice({ revision: 1.5 })), hasCode('CHOICE_REVISION'));
  assert.throws(() => validateChoice(makeChoice({ position: 1.2 })), hasCode('CHOICE_POSITION'));
  assert.throws(() => validateChoice(makeChoice({ profileId: ' ' })), hasCode('CHOICE_PROFILE'));
  assert.throws(() => validateChoice(makeChoice({ coverageTargets: [] })), hasCode('CHOICE_TARGETS'));
  assert.throws(
    () => validateChoice(makeChoice({ sources: ['não-âncora'] as unknown as Anchor[] })),
    hasCode('CHOICE_SOURCES'),
  );
});

test('makeAttempt avalia deterministicamente e preserva snapshot profundo', () => {
  const question = makeChoice();
  const before = JSON.stringify(question);
  const attempt = makeAttempt(question, 'a', 'profile-1', 'seq-1', 'attempt-1', '2026-01-01T00:00:00.000Z');
  assert.equal(JSON.stringify(question), before);
  assert.equal(attempt.correct, true);
  assert.equal(attempt.questionId, question.id);
  assert.equal(attempt.questionRevision, question.revision);
  assert.notEqual(attempt.snapshot, question);
  assert.notEqual(attempt.snapshot.options, question.options);

  question.prompt = 'Mudou';
  question.options[0].text = 'Mudou';
  question.options[0].feedback = 'Mudou';
  assert.equal(attempt.snapshot.prompt, 'Qual é a resposta?');
  assert.equal(attempt.snapshot.options[0].text, 'Alternativa A');
  assert.equal(attempt.snapshot.options[0].feedback, 'Correta.');
});

test('makeAttempt devolve feedback imediato da alternativa escolhida e recusa perfil/opção', () => {
  const question = makeChoice();
  const wrong = makeAttempt(question, 'b', 'profile-1', 'seq-1', 'attempt-2', '2026-01-01T00:00:00.000Z');
  assert.equal(wrong.correct, false);
  assert.equal(wrong.snapshot.options.find(option => option.id === wrong.optionId)?.feedback, 'Incorreta.');

  assert.throws(
    () => makeAttempt(question, 'a', 'outro-perfil', 'seq-1', 'attempt-3', '2026-01-01T00:00:00.000Z'),
    hasCode('ATTEMPT_PROFILE'),
  );
  assert.throws(
    () => makeAttempt(question, 'z', 'profile-1', 'seq-1', 'attempt-4', '2026-01-01T00:00:00.000Z'),
    hasCode('ATTEMPT_OPTION'),
  );
});

test('repeatChoices mantém ordem de position e não mistura perfis', () => {
  const q3 = makeChoice({ id: 'q3', position: 3 });
  const q1 = makeChoice({ id: 'q1', position: 1 });
  const q2 = makeChoice({ id: 'q2', position: 2 });

  const first = repeatChoices([q3, q1, q2], [], false);
  const second = repeatChoices([q3, q1, q2], [], false);
  assert.deepEqual(first.map(question => question.id), ['q1', 'q2', 'q3']);
  assert.deepEqual(second.map(question => question.id), ['q1', 'q2', 'q3']);

  assert.throws(
    () => repeatChoices([makeChoice({ id: 'x', profileId: 'p1' }), makeChoice({ id: 'y', profileId: 'p2' })], [], false),
    hasCode('REPEAT_PROFILE_MIX'),
  );
});

test('repeatChoices usa a última tentativa da sequência mais recente, não taxa histórica', () => {
  const q1 = makeChoice({ id: 'q1', position: 1 });
  const q2 = makeChoice({ id: 'q2', position: 2 });
  const q3 = makeChoice({ id: 'q3', position: 3 });
  const q4 = makeChoice({ id: 'q4', position: 4 });

  const attempts = [
    attemptFor(q1, { id: 'a1', sequenceId: 'old', optionId: 'b', correct: false, createdAt: '2026-01-01T00:00:00.000Z' }),
    attemptFor(q2, { id: 'a2', sequenceId: 'old', optionId: 'b', correct: false, createdAt: '2026-01-01T00:00:01.000Z' }),
    attemptFor(q3, { id: 'a3', sequenceId: 'old', optionId: 'a', correct: true, createdAt: '2026-01-01T00:00:02.000Z' }),
    attemptFor(q4, { id: 'a4', sequenceId: 'old', optionId: 'b', correct: false, createdAt: '2026-01-01T00:00:03.000Z' }),
    attemptFor(q1, { id: 'a5', sequenceId: 'new', optionId: 'a', correct: true, createdAt: '2026-02-01T00:00:00.000Z' }),
    attemptFor(q2, { id: 'a6', sequenceId: 'new', optionId: 'b', correct: false, createdAt: '2026-02-01T00:00:01.000Z' }),
    attemptFor(q2, { id: 'a7', sequenceId: 'new', optionId: 'a', correct: true, createdAt: '2026-02-01T00:00:02.000Z' }),
    attemptFor(q3, { id: 'a8', sequenceId: 'new', optionId: 'b', correct: false, createdAt: '2026-02-01T00:00:03.000Z' }),
  ];

  assert.deepEqual(repeatChoices([q1, q2, q3, q4], attempts, true).map(question => question.id), ['q3']);
});

test('questão corrigida não reclassifica snapshot antigo e nova revisão pode ser oferecida', () => {
  const current = makeChoice({ id: 'q1', revision: 2, position: 1 });
  const oldSnapshot = makeChoice({ id: 'q1', revision: 1, position: 1 });
  const oldAttempt = attemptFor(current, {
    id: 'old-attempt',
    questionRevision: 1,
    optionId: 'b',
    correct: false,
    snapshot: oldSnapshot,
    sequenceId: 'seq-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  assert.deepEqual(repeatChoices([current], [oldAttempt], true).map(question => question.id), ['q1']);
  assert.equal(oldAttempt.questionRevision, 1);
  assert.equal(oldAttempt.snapshot.revision, 1);
  assert.equal(oldAttempt.correct, false);
});

test('repeatChoices ignora tentativas de outro perfil e devolve tudo quando errorsOnly é falso', () => {
  const question = makeChoice({ id: 'q1', profileId: 'p1' });
  const ownCorrect = attemptFor(question, {
    id: 'own',
    profileId: 'p1',
    optionId: 'a',
    correct: true,
    sequenceId: 'seq-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  const foreignWrong = attemptFor(question, {
    id: 'foreign',
    profileId: 'p2',
    optionId: 'b',
    correct: false,
    sequenceId: 'seq-1',
    createdAt: '2026-02-01T00:00:00.000Z',
  });

  assert.deepEqual(repeatChoices([question], [ownCorrect, foreignWrong], true), []);
  assert.deepEqual(repeatChoices([question], [ownCorrect], false).map(item => item.id), ['q1']);
});

test('validateBundle aceita bundle comum e pessoal válidos sem mutar', () => {
  const common = makeCommonBundle();
  const commonBefore = JSON.stringify(common);
  assert.doesNotThrow(() => validateBundle(common));
  assert.equal(JSON.stringify(common), commonBefore);

  const personal = makePersonalBundle();
  const personalBefore = JSON.stringify(personal);
  assert.doesNotThrow(() => validateBundle(personal));
  assert.equal(JSON.stringify(personal), personalBefore);
});

test('validateBundle recusa padrão com choice de perfil, Resource pessoal, sem units ou coverage', () => {
  assert.throws(() => validateBundle(makeCommonBundle({ choices: [makeChoice()] })), hasCode('BUNDLE_COMMON'));
  assert.throws(
    () => validateBundle(makeCommonBundle({ resources: [makeResource({ profileId: 'profile-1' })] })),
    hasCode('BUNDLE_COMMON'),
  );
  assert.throws(() => validateBundle(makeCommonBundle({ units: [] })), hasCode('BUNDLE_COMMON'));
  assert.throws(() => validateBundle(makeCommonBundle({ coverage: [] })), hasCode('BUNDLE_COVERAGE'));
});

test('validateBundle exige profileId, baseRevision e units vazias no pessoal', () => {
  assert.throws(
    () => validateBundle(makePersonalBundle({ resources: [makeResource({ profileId: null, baseRevision: 2 })] })),
    hasCode('BUNDLE_PERSONAL'),
  );
  assert.throws(
    () => validateBundle(makePersonalBundle({ choices: [makeChoice({ profileId: 'outro' })] })),
    hasCode('BUNDLE_PERSONAL'),
  );
  assert.throws(() => validateBundle(makePersonalBundle({ baseRevision: 0 })), hasCode('BUNDLE_BASE_REVISION'));
  assert.throws(() => validateBundle(makePersonalBundle({ units: [makeUnit()] })), hasCode('BUNDLE_PERSONAL'));
  assert.throws(
    () => validateBundle(makePersonalBundle({ resources: [makeResource({ profileId: 'profile-1', baseRevision: 1 })] })),
    hasCode('BUNDLE_PERSONAL'),
  );
});

test('validateBundle confere destinos de coverage e alvos das choices', () => {
  assert.throws(
    () => validateBundle(makeCommonBundle({ coverage: [makeCoverage({ unitIds: ['missing'] })] })),
    hasCode('BUNDLE_COVERAGE'),
  );
  assert.throws(
    () => validateBundle(makeCommonBundle({ coverage: [makeCoverage({ unitIds: [] })] })),
    hasCode('BUNDLE_COVERAGE'),
  );
  assert.doesNotThrow(
    () => validateBundle(makeCommonBundle({ coverage: [makeCoverage({ unitIds: [], gap: 'Falta fonte' })] })),
  );
  assert.throws(
    () => validateBundle(makePersonalBundle({ choices: [makeChoice({ unitId: 'missing' })] })),
    hasCode('BUNDLE_CHOICE_UNIT'),
  );
  assert.throws(
    () => validateBundle(makePersonalBundle({ choices: [makeChoice({ coverageTargets: ['missing'] })] })),
    hasCode('BUNDLE_CHOICE_TARGET'),
  );
  assert.throws(
    () => validateBundle(makePersonalBundle({ coverage: [makeCoverage({ practiceIds: ['missing'] })] })),
    hasCode('BUNDLE_COVERAGE'),
  );
});

test('validateBundle exige fonte, alvo, finalidade, conteúdo e tipo textual existente', () => {
  for (const type of ['explanation', 'analogy', 'context', 'contrast', 'interpretation', 'reflection', 'vocabulary']) {
    assert.doesNotThrow(() => validateBundle(makeCommonBundle({ resources: [makeResource({ type })] })));
  }

  assert.throws(
    () => validateBundle(makeCommonBundle({ resources: [makeResource({ sources: [] })] })),
    hasCode('BUNDLE_RESOURCE'),
  );
  assert.throws(
    () => validateBundle(makeCommonBundle({ resources: [makeResource({ targets: [] })] })),
    hasCode('BUNDLE_RESOURCE'),
  );
  assert.throws(
    () => validateBundle(makeCommonBundle({ resources: [makeResource({ purpose: '' })] })),
    hasCode('BUNDLE_RESOURCE'),
  );
  assert.throws(
    () => validateBundle(makeCommonBundle({ resources: [makeResource({ body: '' })] })),
    hasCode('BUNDLE_RESOURCE'),
  );
  assert.throws(
    () => validateBundle(makeCommonBundle({ resources: [makeResource({ type: 'video' })] })),
    hasCode('BUNDLE_RESOURCE_TYPE'),
  );
});

test('validateBundle só publica com inspeção ai concluída e sem achados', () => {
  assert.throws(
    () => validateBundle(makeCommonBundle({
      inspection: { kind: 'human' as unknown as 'ai', references: [], findings: [], completed: true },
    })),
    hasCode('BUNDLE_INSPECTION'),
  );
  assert.throws(
    () => validateBundle(makeCommonBundle({
      inspection: { kind: 'ai', references: [], findings: [], completed: false },
    })),
    hasCode('BUNDLE_INSPECTION'),
  );
  assert.throws(
    () => validateBundle(makeCommonBundle({
      inspection: { kind: 'ai', references: [], findings: ['achado'], completed: true },
    })),
    hasCode('BUNDLE_FINDINGS'),
  );
});

function catalogEntry(overrides: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'kind'>): CatalogEntry {
  return {
    name: 'Método',
    purpose: 'Finalidade',
    conditions: [],
    limits: [],
    instructions: 'Instruções',
    references: [],
    type: 'textual',
    revision: 1,
    ...overrides,
  };
}

test('effectiveCatalog preserva override quando o comum atualiza e separa kinds', () => {
  const common = [
    catalogEntry({ id: 'm1', kind: 'method', name: 'Método base', revision: 2, conditions: ['base'] }),
    catalogEntry({ id: 'r1', kind: 'resource', name: 'Recurso base', revision: 4, conditions: ['base'] }),
  ];
  const overrides = [
    catalogEntry({ id: 'm1', kind: 'method', name: 'Método autoral', revision: 1, conditions: ['autoral'] }),
    catalogEntry({ id: 'r-new', kind: 'resource', name: 'Novo recurso' }),
    catalogEntry({ id: 'm-new', kind: 'method', name: 'Novo método' }),
  ];

  const result = effectiveCatalog(common, overrides);
  assert.deepEqual(result.map(entry => entry.id), ['m1', 'm-new', 'r1', 'r-new']);
  assert.deepEqual(result.map(entry => entry.kind), ['method', 'method', 'resource', 'resource']);
  assert.equal(result[0].name, 'Método autoral');
  assert.equal(result[0].revision, 1);
});

test('effectiveCatalog omite disabled, recusa mudança de kind e clona a saída', () => {
  assert.deepEqual(
    effectiveCatalog([catalogEntry({ id: 'm1', kind: 'method', disabled: true })], []),
    [],
  );
  assert.deepEqual(
    effectiveCatalog(
      [catalogEntry({ id: 'm1', kind: 'method' })],
      [catalogEntry({ id: 'm1', kind: 'method', disabled: true })],
    ),
    [],
  );
  assert.deepEqual(
    effectiveCatalog([], [catalogEntry({ id: 'new', kind: 'resource', disabled: true })]),
    [],
  );
  assert.throws(
    () => effectiveCatalog(
      [catalogEntry({ id: 'x', kind: 'method' })],
      [catalogEntry({ id: 'x', kind: 'resource' })],
    ),
    hasCode('CATALOG_KIND'),
  );

  const common = [catalogEntry({ id: 'r1', kind: 'resource', name: 'Publicado', conditions: ['original'] })];
  const overrides = [catalogEntry({ id: 'm1', kind: 'method', name: 'Autoral', conditions: ['autoral'] })];
  const result = effectiveCatalog(common, overrides);
  result[0].name = 'Mutado';
  result[0].conditions.push('mutado');
  result[1].name = 'Mutado também';
  assert.equal(overrides[0].name, 'Autoral');
  assert.deepEqual(overrides[0].conditions, ['autoral']);
  assert.equal(common[0].name, 'Publicado');
  assert.deepEqual(common[0].conditions, ['original']);
});
