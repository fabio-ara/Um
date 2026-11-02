import type { Answers, Condition, FormDefinition, Question } from './contracts.ts';
import { ensure } from './errors.ts';

const DEFAULT_MAX_QUESTIONS = 6;
const HARD_MAX_QUESTIONS = 64;
const MAX_FAMILIARITY_REFERENCES = 3;
const MAX_QUESTION_BUDGET = 32;

// Sentinel used only while exploring the form's possible paths. It is never
// returned to callers and never written into a draft.
const TEXT_PRESENT = '\u0000text-present';

type AnswerValue = string | string[];

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function getOwnAnswer(answers: Answers, id: string): string | string[] | undefined {
  return hasOwn(answers, id) ? answers[id] : undefined;
}

function setOwnAnswer(answers: Answers, id: string, value: AnswerValue): void {
  Object.defineProperty(answers, id, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  });
}

function optionIds(question: Question): Set<string> {
  return new Set((question.options ?? []).map(option => option.id));
}

function conditionMatches(condition: Condition, answer: string | string[] | undefined): boolean {
  if (answer === undefined || answer === null) return false;

  if (condition.operator === 'present') {
    return Array.isArray(answer) ? answer.length > 0 : answer.trim().length > 0;
  }

  const values = condition.values ?? [];
  if (Array.isArray(answer)) {
    return answer.some(value => values.includes(value));
  }
  return values.includes(answer);
}

function isVisible(question: Question, answers: Answers): boolean {
  const condition = question.showWhen;
  if (condition === undefined) return true;
  return conditionMatches(condition, getOwnAnswer(answers, condition.questionId));
}

/**
 * A valid (or absent) answer for the purposes of visibility. Any malformed
 * value is ignored; a hidden question is therefore unable to activate a
 * descendant.
 */
function normalizeAnswer(question: Question, value: unknown): AnswerValue | undefined {
  if (value === undefined || value === null) return undefined;

  if (question.type === 'text') {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  if (question.type === 'single_choice') {
    if (typeof value !== 'string' || value.length === 0) return undefined;
    return optionIds(question).has(value) ? value : undefined;
  }

  if (!Array.isArray(value)) return undefined;
  const allowed = optionIds(question);
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item)) return undefined;
    if (!seen.has(item)) {
      seen.add(item);
      selected.push(item);
    }
  }
  return selected.length > 0 ? selected : undefined;
}

/**
 * Like normalizeAnswer, but a present malformed answer is an error. Empty
 * free text / an empty multiple selection is treated as no answer.
 */
function readSubmissionAnswer(question: Question, value: unknown): AnswerValue | undefined {
  if (value === undefined || value === null) return undefined;

  if (question.type === 'text') {
    ensure(typeof value === 'string', 'INVALID_ANSWER', `Texto inválido para ${question.id}.`);
    return value.trim().length > 0 ? value : undefined;
  }

  if (question.type === 'single_choice') {
    ensure(typeof value === 'string', 'INVALID_ANSWER', `Resposta inválida para ${question.id}.`);
    ensure(optionIds(question).has(value), 'INVALID_OPTION', `Opção inexistente para ${question.id}.`);
    return value;
  }

  ensure(Array.isArray(value), 'INVALID_ANSWER', `Resposta inválida para ${question.id}.`);
  const allowed = optionIds(question);
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const item of value) {
    ensure(typeof item === 'string', 'INVALID_ANSWER', `Resposta inválida para ${question.id}.`);
    ensure(allowed.has(item), 'INVALID_OPTION', `Opção inexistente para ${question.id}.`);
    if (!seen.has(item)) {
      seen.add(item);
      selected.push(item);
    }
  }
  return selected.length > 0 ? selected : undefined;
}

function validateCondition(condition: Condition, seen: Map<string, Question>): void {
  ensure(condition !== null && typeof condition === 'object', 'INVALID_CONDITION', 'Condição inválida.');
  ensure(
    typeof condition.questionId === 'string' && condition.questionId.length > 0,
    'INVALID_CONDITION',
    'Condição sem pergunta referida.'
  );

  const referenced = seen.get(condition.questionId);
  ensure(referenced !== undefined, 'CONDITION_NOT_PREVIOUS', `Condição referencia pergunta inexistente ou não anterior: ${condition.questionId}.`);

  const operator = condition.operator;
  ensure(
    operator === 'equals' || operator === 'in' || operator === 'present',
    'INVALID_CONDITION_OPERATOR',
    `Operador de condição inválido: ${String(operator)}.`
  );

  const rawValues = condition.values;
  if (operator === 'present') {
    ensure(
      rawValues === undefined || (Array.isArray(rawValues) && rawValues.length === 0),
      'INVALID_CONDITION',
      'present não aceita valores.'
    );
    return;
  }

  ensure(
    referenced.type === 'single_choice' || referenced.type === 'multiple_choice',
    'INVALID_CONDITION',
    'Texto livre só admite a condição present.'
  );
  ensure(Array.isArray(rawValues), 'INVALID_CONDITION', 'Condição sem valores.');

  if (operator === 'equals') {
    ensure(rawValues.length === 1, 'INVALID_CONDITION', 'equals exige exatamente um valor.');
  } else {
    ensure(rawValues.length > 0, 'INVALID_CONDITION', 'in exige ao menos um valor.');
  }

  const allowed = optionIds(referenced);
  for (const value of rawValues) {
    ensure(typeof value === 'string' && value.length > 0, 'INVALID_CONDITION', 'Valor de condição inválido.');
    ensure(allowed.has(value), 'INVALID_CONDITION_VALUE', `Valor de condição inexistente na pergunta ${referenced.id}: ${value}.`);
  }
}

function validateQuestion(question: Question, seen: Map<string, Question>, ids: Set<string>): void {
  ensure(question !== null && typeof question === 'object', 'INVALID_QUESTION', 'Pergunta inválida.');
  ensure(typeof question.id === 'string' && question.id.trim().length > 0, 'INVALID_QUESTION', 'Pergunta sem id.');
  ensure(!ids.has(question.id), 'DUPLICATE_QUESTION_ID', `Id de pergunta duplicado: ${question.id}.`);
  ids.add(question.id);

  ensure(
    question.type === 'single_choice' || question.type === 'multiple_choice' || question.type === 'text',
    'INVALID_QUESTION_TYPE',
    `Tipo de pergunta inválido: ${String(question.type)}.`
  );
  ensure(
    typeof question.prompt === 'string' && question.prompt.trim().length > 0,
    'INVALID_QUESTION',
    `Pergunta sem enunciado: ${question.id}.`
  );
  ensure(typeof question.required === 'boolean', 'INVALID_QUESTION', `Pergunta com required inválido: ${question.id}.`);

  if (question.type === 'text') {
    ensure(question.required === false, 'INVALID_QUESTION', `Texto livre deve ser opcional: ${question.id}.`);
    ensure(
      question.options === undefined || (Array.isArray(question.options) && question.options.length === 0),
      'INVALID_OPTIONS',
      `Texto livre não aceita opções: ${question.id}.`
    );
  } else {
    ensure(
      Array.isArray(question.options) && question.options.length > 0,
      'INVALID_OPTIONS',
      `Pergunta de escolha sem opções: ${question.id}.`
    );
    const idsOfOptions = new Set<string>();
    for (const option of question.options) {
      ensure(option !== null && typeof option === 'object', 'INVALID_OPTIONS', `Opção inválida em ${question.id}.`);
      ensure(typeof option.id === 'string' && option.id.trim().length > 0, 'INVALID_OPTIONS', `Opção sem id em ${question.id}.`);
      ensure(!idsOfOptions.has(option.id), 'DUPLICATE_OPTION_ID', `Opção duplicada em ${question.id}: ${option.id}.`);
      ensure(
        typeof option.label === 'string' && option.label.trim().length > 0,
        'INVALID_OPTIONS',
        `Opção sem rótulo em ${question.id}: ${option.id}.`
      );
      idsOfOptions.add(option.id);
    }
  }

  if (question.familiarityReferences !== undefined) {
    ensure(
      Array.isArray(question.familiarityReferences) &&
        question.familiarityReferences.length <= MAX_FAMILIARITY_REFERENCES,
      'INVALID_FAMILIARITY_REFERENCES',
      `familiarityReferences deve ter no máximo ${MAX_FAMILIARITY_REFERENCES} itens: ${question.id}.`
    );
    for (const reference of question.familiarityReferences) {
      ensure(
        typeof reference === 'string' && reference.trim().length > 0,
        'INVALID_FAMILIARITY_REFERENCES',
        `Referência de familiaridade inválida: ${question.id}.`
      );
    }
  }

  if (question.showWhen !== undefined) {
    validateCondition(question.showWhen, seen);
  }

  seen.set(question.id, question);
}

function encodeAnswer(answer: AnswerValue): string {
  return JSON.stringify(answer);
}

function budgetChoices(question: Question): AnswerValue[] {
  if (question.type === 'text') return [TEXT_PRESENT];
  const ids = (question.options ?? []).map(option => option.id);
  // More selected options can only make more positive conditions true, so the
  // worst case for a multiple selection is selecting every option.
  if (question.type === 'multiple_choice') return [ids];
  return ids;
}

/**
 * True when some possible path makes more than `limit` questions visible.
 * The search is exact and prunes only when even every remaining question would
 * not be enough to exceed the limit.
 */
function exceedsQuestionBudget(questions: Question[], limit: number): boolean {
  const total = questions.length;
  const suffixReferences: string[][] = new Array(total + 1);
  const references = new Set<string>();
  suffixReferences[total] = [];
  for (let index = total - 1; index >= 0; index -= 1) {
    const condition = questions[index].showWhen;
    if (condition !== undefined) references.add(condition.questionId);
    suffixReferences[index] = [...references];
  }

  const visited = new Set<string>();

  function stateKey(index: number, answers: Answers): string {
    const parts: [string, string][] = [];
    for (const id of suffixReferences[index]) {
      if (hasOwn(answers, id)) {
        parts.push([id, encodeAnswer(answers[id])]);
      }
    }
    return JSON.stringify(parts);
  }

  function search(index: number, answers: Answers, visible: number): boolean {
    if (visible > limit) return true;
    if (index >= total) return false;
    if (visible + (total - index) <= limit) return false;

    const key = `${index}|${visible}|${stateKey(index, answers)}`;
    if (visited.has(key)) return false;
    ensure(visited.size < 50000, 'FORM_COMPLEXITY', 'Simplifique as condições para conferir todos os percursos.');
    visited.add(key);

    const question = questions[index];
    if (!isVisible(question, answers)) {
      return search(index + 1, answers, visible);
    }

    for (const choice of budgetChoices(question)) {
      const next: Answers = { ...answers, [question.id]: choice };
      if (search(index + 1, next, visible + 1)) return true;
    }
    return false;
  }

  return search(0, {}, 0);
}

/**
 * Validates the shape and the conditional budget of a form definition.
 */
export function validateForm(form: FormDefinition): void {
  ensure(form !== null && typeof form === 'object', 'INVALID_FORM', 'Formulário inválido.');
  ensure(Array.isArray(form.questions), 'INVALID_FORM', 'Formulário sem perguntas.');
  ensure(
    form.questions.length <= HARD_MAX_QUESTIONS,
    'FORM_TOO_LARGE',
    `O formulário excede ${HARD_MAX_QUESTIONS} perguntas.`
  );

  const rawLimit = (form as { maxQuestions?: unknown }).maxQuestions;
  const limit = rawLimit === undefined ? DEFAULT_MAX_QUESTIONS : rawLimit;
  ensure(
    typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= MAX_QUESTION_BUDGET,
    'INVALID_MAX_QUESTIONS',
    `maxQuestions deve ser inteiro entre 1 e ${MAX_QUESTION_BUDGET}.`
  );

  const seen = new Map<string, Question>();
  const ids = new Set<string>();
  for (const question of form.questions) {
    validateQuestion(question, seen, ids);
  }

  ensure(
    !exceedsQuestionBudget(form.questions, limit),
    'QUESTION_BUDGET_EXCEEDED',
    'Algum percurso possível excede o orçamento de perguntas visíveis.'
  );
}

/**
 * Keeps only visible, well-formed answers. The input draft is never mutated.
 */
export function effectiveAnswers(form: FormDefinition, draft: Answers): Answers {
  const answers: Answers = {};
  const result: Answers = {};

  for (const question of form.questions) {
    if (!isVisible(question, answers)) continue;
    const normalized = normalizeAnswer(question, getOwnAnswer(draft, question.id));
    if (normalized === undefined) continue;
    setOwnAnswer(answers, question.id, normalized);
    setOwnAnswer(result, question.id, normalized);
  }

  return result;
}

/**
 * Questions visible for the draft, in the form's original order.
 */
export function visibleQuestions(form: FormDefinition, draft: Answers): Question[] {
  const answers: Answers = {};
  const visible: Question[] = [];

  for (const question of form.questions) {
    if (!isVisible(question, answers)) continue;
    visible.push(question);
    const normalized = normalizeAnswer(question, getOwnAnswer(draft, question.id));
    if (normalized !== undefined) {
      setOwnAnswer(answers, question.id, normalized);
    }
  }

  return visible;
}

/**
 * Validates only the active (visible) questions and returns the applicable
 * answers. Hidden answers and unknown keys are ignored.
 */
export function validateSubmission(form: FormDefinition, draft: Answers): Answers {
  const answers: Answers = {};
  const result: Answers = {};

  for (const question of form.questions) {
    if (!isVisible(question, answers)) continue;

    const present = hasOwn(draft, question.id);
    const normalized = present ? readSubmissionAnswer(question, draft[question.id]) : undefined;

    if (normalized === undefined) {
      ensure(!question.required, 'REQUIRED_ANSWER_MISSING', `Resposta obrigatória ausente: ${question.id}.`);
      continue;
    }

    setOwnAnswer(answers, question.id, normalized);
    setOwnAnswer(result, question.id, normalized);
  }

  return result;
}
