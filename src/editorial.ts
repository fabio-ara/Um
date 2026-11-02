import { anchorSchema, type Anchor, type Attempt, type CatalogEntry, type Choice, type ContentBundle } from './contracts.ts';
import { ensure } from './errors.ts';

const RESOURCE_TYPES = new Set([
  'explanation',
  'analogy',
  'context',
  'contrast',
  'interpretation',
  'reflection',
  'vocabulary',
]);

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertNonEmpty(value: unknown, code: string, message: string): asserts value is string {
  ensure(typeof value === 'string' && value.trim().length > 0, code, message);
}

function assertInteger(value: unknown, code: string, message: string, minimum = 0): asserts value is number {
  ensure(typeof value === 'number' && Number.isInteger(value) && value >= minimum, code, message);
}

function assertAnchors(value: unknown, code: string, message: string): asserts value is Anchor[] {
  ensure(Array.isArray(value), code, message);
  for (const anchor of value as unknown[]) {
    ensure(anchorSchema.safeParse(anchor).success, code, message);
  }
}

function latestAttempt(attempts: Attempt[]): Attempt | undefined {
  let latest: Attempt | undefined;
  let latestTime = -Infinity;
  for (const attempt of attempts) {
    const time = Date.parse(attempt.createdAt);
    const normalized = Number.isFinite(time) ? time : -Infinity;
    if (latest === undefined || normalized >= latestTime) {
      latest = attempt;
      latestTime = normalized;
    }
  }
  return latest;
}

export function validateChoice(q: Choice): void {
  ensure(q && typeof q === 'object', 'CHOICE_INVALID', 'Escolha inválida.');
  assertNonEmpty(q.id, 'CHOICE_ID', 'Escolha sem identidade.');
  assertInteger(q.revision, 'CHOICE_REVISION', 'Revisão deve ser inteira e positiva.', 1);
  assertNonEmpty(q.unitId, 'CHOICE_UNIT', 'Escolha sem unidade.');
  assertNonEmpty(q.profileId, 'CHOICE_PROFILE', 'Perfil deve ser explícito.');
  assertInteger(q.position, 'CHOICE_POSITION', 'Posição deve ser inteira.', 0);
  assertNonEmpty(q.prompt, 'CHOICE_PROMPT', 'Enunciado vazio.');

  ensure(Array.isArray(q.options), 'CHOICE_OPTIONS', 'Alternativas ausentes.');
  ensure(q.options.length >= 2, 'CHOICE_OPTIONS', 'São necessárias ao menos duas alternativas.');
  const optionIds = new Set<string>();
  for (const option of q.options) {
    ensure(option && typeof option === 'object', 'CHOICE_OPTIONS', 'Alternativa inválida.');
    assertNonEmpty(option.id, 'CHOICE_OPTIONS', 'Alternativa sem identidade.');
    ensure(!optionIds.has(option.id), 'CHOICE_OPTIONS', 'Identidades de alternativa repetidas.');
    optionIds.add(option.id);
    assertNonEmpty(option.text, 'CHOICE_OPTION_TEXT', 'Alternativa sem enunciado.');
    assertNonEmpty(option.feedback, 'CHOICE_OPTION_FEEDBACK', 'Alternativa sem feedback.');
  }

  assertNonEmpty(q.correctOptionId, 'CHOICE_CORRECT', 'Alternativa correta ausente.');
  ensure(optionIds.has(q.correctOptionId), 'CHOICE_CORRECT', 'Alternativa correta inexistente.');

  ensure(Array.isArray(q.coverageTargets) && q.coverageTargets.length > 0, 'CHOICE_TARGETS', 'Alvos de cobertura ausentes.');
  const targets = new Set<string>();
  for (const target of q.coverageTargets) {
    assertNonEmpty(target, 'CHOICE_TARGETS', 'Alvo de cobertura vazio.');
    ensure(!targets.has(target), 'CHOICE_TARGETS', 'Alvos de cobertura repetidos.');
    targets.add(target);
  }

  assertAnchors(q.sources, 'CHOICE_SOURCES', 'Fontes devem ser âncoras estruturadas.');
}

export function makeAttempt(
  q: Choice,
  optionId: string,
  profileId: string,
  sequenceId: string,
  attemptId: string,
  createdAt: string,
): Attempt {
  validateChoice(q);
  ensure(q && typeof q === 'object', 'ATTEMPT_INVALID', 'Escolha inválida.');
  assertNonEmpty(q.id, 'ATTEMPT_INVALID', 'Questão sem identidade.');
  assertInteger(q.revision, 'ATTEMPT_INVALID', 'Revisão da questão inválida.', 1);
  assertNonEmpty(profileId, 'ATTEMPT_PROFILE', 'Perfil do attempt deve ser explícito.');
  ensure(q.profileId === profileId, 'ATTEMPT_PROFILE', 'Perfil não corresponde à escolha.');
  assertNonEmpty(optionId, 'ATTEMPT_OPTION', 'Alternativa ausente.');
  ensure(Array.isArray(q.options), 'ATTEMPT_OPTION', 'Alternativas ausentes.');
  ensure(q.options.some(option => option.id === optionId), 'ATTEMPT_OPTION', 'Alternativa não pertence à escolha.');
  assertNonEmpty(sequenceId, 'ATTEMPT_SEQUENCE', 'Sequência ausente.');
  assertNonEmpty(attemptId, 'ATTEMPT_ID', 'Tentativa sem identidade.');
  assertNonEmpty(createdAt, 'ATTEMPT_CREATED_AT', 'Data da tentativa ausente.');
  ensure(!Number.isNaN(Date.parse(createdAt)), 'ATTEMPT_CREATED_AT', 'Data da tentativa inválida.');

  return {
    id: attemptId,
    profileId,
    questionId: q.id,
    questionRevision: q.revision,
    sequenceId,
    optionId,
    correct: optionId === q.correctOptionId,
    snapshot: deepCopy(q),
    createdAt,
  };
}

export function repeatChoices(questions: Choice[], lastAttempts: Attempt[], errorsOnly: boolean): Choice[] {
  ensure(Array.isArray(questions), 'REPEAT_INVALID', 'Lista de questões inválida.');
  ensure(Array.isArray(lastAttempts), 'REPEAT_INVALID', 'Lista de tentativas inválida.');
  ensure(typeof errorsOnly === 'boolean', 'REPEAT_INVALID', 'errorsOnly deve ser booleano.');

  const ordered = [...questions].sort((a, b) => a.position - b.position);
  if (ordered.length === 0) return [];

  const profiles = new Set(ordered.map(question => question.profileId));
  ensure(profiles.size === 1, 'REPEAT_PROFILE_MIX', 'Não misture perfis na repetição.');
  if (!errorsOnly) return ordered;

  const profileId = ordered[0].profileId;
  const questionIds = new Set(ordered.map(question => question.id));
  const relevant = lastAttempts.filter(attempt => attempt.profileId === profileId && questionIds.has(attempt.questionId));
  if (relevant.length === 0) return [];

  const sequenceTimes = new Map<string, number>();
  for (const attempt of relevant) {
    const time = Date.parse(attempt.createdAt);
    const normalized = Number.isFinite(time) ? time : -Infinity;
    const previous = sequenceTimes.get(attempt.sequenceId);
    if (previous === undefined || normalized > previous) sequenceTimes.set(attempt.sequenceId, normalized);
  }

  let latestSequenceId: string | null = null;
  let latestTime = -Infinity;
  for (const [sequenceId, time] of sequenceTimes) {
    if (latestSequenceId === null || time > latestTime || (time === latestTime && sequenceId > latestSequenceId)) {
      latestSequenceId = sequenceId;
      latestTime = time;
    }
  }
  if (latestSequenceId === null) return [];

  const result: Choice[] = [];
  for (const question of ordered) {
    const inLatest = relevant.filter(attempt => attempt.sequenceId === latestSequenceId && attempt.questionId === question.id);
    if (inLatest.length === 0) continue;
    const last = latestAttempt(inLatest);
    if (last === undefined) continue;

    if (last.questionRevision !== question.revision) {
      // Revisão nova é oferecida como nova; o snapshot antigo não é reclassificado.
      result.push(question);
    } else if (last.correct === false) {
      result.push(question);
    }
  }
  return result;
}

export function validateBundle(bundle: ContentBundle): void {
  ensure(bundle && typeof bundle === 'object', 'BUNDLE_INVALID', 'Bundle inválido.');
  assertNonEmpty(bundle.projectId, 'BUNDLE_PROJECT', 'Projeto ausente.');
  assertInteger(bundle.revision, 'BUNDLE_REVISION', 'Revisão do bundle deve ser inteira e positiva.', 1);
  ensure(
    bundle.profileId === null || (typeof bundle.profileId === 'string' && bundle.profileId.trim().length > 0),
    'BUNDLE_PROFILE',
    'Perfil do bundle inválido.',
  );
  assertInteger(bundle.baseRevision, 'BUNDLE_BASE_REVISION', 'baseRevision inválida.', 0);

  const personal = bundle.profileId !== null;
  if (personal) {
    ensure(bundle.baseRevision >= 1, 'BUNDLE_BASE_REVISION', 'Bundle pessoal deve apontar baseRevision.');
  }

  ensure(Array.isArray(bundle.units), 'BUNDLE_UNITS', 'units inválidas.');
  ensure(Array.isArray(bundle.resources), 'BUNDLE_RESOURCES', 'resources inválidos.');
  ensure(Array.isArray(bundle.choices), 'BUNDLE_CHOICES', 'choices inválidas.');
  ensure(Array.isArray(bundle.coverage), 'BUNDLE_COVERAGE', 'coverage inválida.');

  ensure(bundle.inspection && typeof bundle.inspection === 'object', 'BUNDLE_INSPECTION', 'Inspeção ausente.');
  ensure(bundle.inspection.kind === 'ai', 'BUNDLE_INSPECTION', "inspection.kind deve ser 'ai'.");
  ensure(Array.isArray(bundle.inspection.references), 'BUNDLE_INSPECTION', 'Referências de inspeção inválidas.');
  ensure(Array.isArray(bundle.inspection.findings), 'BUNDLE_INSPECTION', 'Achados de inspeção inválidos.');
  ensure(bundle.inspection.findings.length === 0, 'BUNDLE_FINDINGS', 'Achados impeditivos recusam o bundle.');
  ensure(bundle.inspection.completed === true, 'BUNDLE_INSPECTION', 'Inspeção deve estar concluída para publicar.');

  if (!personal) {
    ensure(bundle.units.length > 0, 'BUNDLE_COMMON', 'Bundle comum precisa de units.');
  } else {
    ensure(bundle.units.length === 0, 'BUNDLE_PERSONAL', 'Bundle pessoal não reescreve units comuns.');
  }

  const unitIds = new Set<string>();
  for (const unit of bundle.units) {
    ensure(unit && typeof unit === 'object', 'BUNDLE_UNITS', 'Unidade inválida.');
    assertNonEmpty(unit.id, 'BUNDLE_UNITS', 'Unidade sem identidade.');
    ensure(!unitIds.has(unit.id), 'BUNDLE_UNITS', 'Identidades de unidade repetidas.');
    unitIds.add(unit.id);
  }

  ensure(bundle.coverage.length > 0, 'BUNDLE_COVERAGE', 'Bundle precisa de coverage.');
  const coverageIds = new Set<string>();
  const baseUnitIndex = new Set<string>();
  for (const item of bundle.coverage) {
    ensure(item && typeof item === 'object', 'BUNDLE_COVERAGE', 'Cobertura inválida.');
    assertNonEmpty(item.id, 'BUNDLE_COVERAGE', 'Cobertura sem identidade.');
    ensure(!coverageIds.has(item.id), 'BUNDLE_COVERAGE', 'Identidades de cobertura repetidas.');
    coverageIds.add(item.id);
    assertNonEmpty(item.description, 'BUNDLE_COVERAGE', 'Cobertura sem descrição.');
    ensure(Array.isArray(item.unitIds), 'BUNDLE_COVERAGE', 'Unidades de cobertura inválidas.');
    ensure(Array.isArray(item.practiceIds), 'BUNDLE_COVERAGE', 'Práticas de cobertura inválidas.');
    assertAnchors(item.sourceAnchors, 'BUNDLE_COVERAGE', 'Fontes de cobertura devem ser âncoras estruturadas.');

    for (const unitId of item.unitIds) {
      assertNonEmpty(unitId, 'BUNDLE_COVERAGE', 'Unidade de cobertura vazia.');
      baseUnitIndex.add(unitId);
      if (!personal) {
        ensure(unitIds.has(unitId), 'BUNDLE_COVERAGE', 'Unidade de cobertura inexistente.');
      }
    }

    if (item.gap !== undefined) {
      ensure(typeof item.gap === 'string', 'BUNDLE_COVERAGE', 'Lacuna inválida.');
    }
    const declaredGap = typeof item.gap === 'string' && item.gap.trim().length > 0;
    ensure(item.unitIds.length > 0 || declaredGap, 'BUNDLE_COVERAGE', 'Lacuna não declarada não pode passar como coberta.');
  }

  const resourceIds = new Set<string>();
  for (const resource of bundle.resources) {
    ensure(resource && typeof resource === 'object', 'BUNDLE_RESOURCES', 'Recurso inválido.');
    assertNonEmpty(resource.id, 'BUNDLE_RESOURCES', 'Recurso sem identidade.');
    ensure(!resourceIds.has(resource.id), 'BUNDLE_RESOURCES', 'Identidades de recurso repetidas.');
    resourceIds.add(resource.id);

    if (personal) {
      ensure(resource.profileId === bundle.profileId, 'BUNDLE_PERSONAL', 'Todo recurso pessoal precisa do profileId do bundle.');
      ensure(resource.baseRevision === bundle.baseRevision, 'BUNDLE_PERSONAL', 'Recurso pessoal deve usar a baseRevision do bundle.');
    } else {
      ensure(resource.profileId === null, 'BUNDLE_COMMON', 'Bundle comum não contém Resource pessoal.');
    }

    assertNonEmpty(resource.purpose, 'BUNDLE_RESOURCE', 'Recurso sem finalidade.');
    assertNonEmpty(resource.body, 'BUNDLE_RESOURCE', 'Recurso sem conteúdo.');
    ensure(typeof resource.type === 'string' && RESOURCE_TYPES.has(resource.type), 'BUNDLE_RESOURCE_TYPE', 'Tipo de recurso inexistente.');
    assertAnchors(resource.sources, 'BUNDLE_RESOURCE', 'Fontes do recurso devem ser âncoras estruturadas.');
    ensure(resource.sources.length > 0, 'BUNDLE_RESOURCE', 'Recurso sem fonte.');
    assertAnchors(resource.targets, 'BUNDLE_RESOURCE', 'Alvos do recurso devem ser âncoras estruturadas.');
    ensure(resource.targets.length > 0, 'BUNDLE_RESOURCE', 'Recurso sem alvo.');
    ensure(resource.inspection === 'pending' || resource.inspection === 'ai_inspected', 'BUNDLE_RESOURCE', 'Inspeção de recurso inválida.');
  }

  if (!personal) {
    ensure(bundle.choices.length === 0, 'BUNDLE_COMMON', 'Bundle comum não contém choice de perfil.');
  }

  const knownUnits = personal ? baseUnitIndex : unitIds;
  const choiceIds = new Set<string>();
  for (const choice of bundle.choices) {
    validateChoice(choice);
    ensure(choice && typeof choice === 'object', 'BUNDLE_CHOICES', 'Escolha inválida.');
    ensure(!choiceIds.has(choice.id), 'BUNDLE_CHOICES', 'Identidades de escolha repetidas.');
    choiceIds.add(choice.id);

    if (personal) {
      ensure(choice.profileId === bundle.profileId, 'BUNDLE_PERSONAL', 'Toda choice pessoal precisa do profileId do bundle.');
    }
    ensure(knownUnits.has(choice.unitId), 'BUNDLE_CHOICE_UNIT', 'Escolha referencia unidade desconhecida.');
    for (const target of choice.coverageTargets) {
      ensure(coverageIds.has(target), 'BUNDLE_CHOICE_TARGET', 'Escolha cobre alvo não declarado.');
    }
  }

  for (const item of bundle.coverage) {
    for (const practiceId of item.practiceIds) {
      assertNonEmpty(practiceId, 'BUNDLE_COVERAGE', 'Prática de cobertura vazia.');
      ensure(choiceIds.has(practiceId), 'BUNDLE_COVERAGE', 'Prática de cobertura inexistente.');
    }
  }
}

function copyCatalogEntry(entry: CatalogEntry): CatalogEntry {
  return {
    ...entry,
    conditions: [...entry.conditions],
    limits: [...entry.limits],
    references: [...entry.references],
  };
}

export function effectiveCatalog(common: CatalogEntry[], overrides: CatalogEntry[]): CatalogEntry[] {
  ensure(Array.isArray(common), 'CATALOG_INVALID', 'Catálogo comum inválido.');
  ensure(Array.isArray(overrides), 'CATALOG_INVALID', 'Sobreposições inválidas.');

  const commonById = new Map<string, CatalogEntry>();
  for (const entry of common) {
    ensure(entry && typeof entry === 'object', 'CATALOG_INVALID', 'Entrada de catálogo inválida.');
    assertNonEmpty(entry.id, 'CATALOG_INVALID', 'Entrada sem identidade.');
    ensure(!commonById.has(entry.id), 'CATALOG_DUPLICATE', 'Identidade de catálogo repetida na base.');
    commonById.set(entry.id, entry);
  }

  const overrideById = new Map<string, CatalogEntry>();
  for (const entry of overrides) {
    ensure(entry && typeof entry === 'object', 'CATALOG_INVALID', 'Sobreposição inválida.');
    assertNonEmpty(entry.id, 'CATALOG_INVALID', 'Sobreposição sem identidade.');
    ensure(!overrideById.has(entry.id), 'CATALOG_DUPLICATE', 'Identidade de catálogo repetida na sobreposição.');
    overrideById.set(entry.id, entry);
  }

  for (const [entryId, override] of overrideById) {
    const base = commonById.get(entryId);
    if (base) {
      ensure(override.kind === base.kind, 'CATALOG_KIND', 'Não é permitido mudar o kind do mesmo id.');
    }
  }

  const methods: CatalogEntry[] = [];
  const resources: CatalogEntry[] = [];
  const push = (entry: CatalogEntry) => {
    const copy = copyCatalogEntry(entry);
    if (copy.kind === 'method') methods.push(copy);
    else resources.push(copy);
  };

  for (const entry of common) {
    if (entry.disabled === true) continue;
    const override = overrideById.get(entry.id);
    if (override) {
      if (override.disabled === true) continue;
      push(override);
    } else {
      push(entry);
    }
  }

  for (const entry of overrides) {
    if (commonById.has(entry.id) || entry.disabled === true) continue;
    push(entry);
  }

  return [...methods, ...resources];
}
