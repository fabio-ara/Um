import test from 'node:test';
import assert from 'node:assert/strict';

import type { Answers, Condition, FormDefinition, Question } from '../src/contracts.ts';
import { AppError } from '../src/errors.ts';
import { effectiveAnswers, validateForm, validateSubmission, visibleQuestions } from '../src/forms.ts';

function options(...ids: string[]): { id: string; label: string }[] {
  return ids.map(id => ({ id, label: id }));
}

function question(id: string, type: Question['type'], extra: Partial<Question> = {}): Question {
  return { id, type, prompt: `Pergunta ${id}`, required: false, ...extra };
}

function form(questions: Question[], maxQuestions: number | undefined = 6): FormDefinition {
  return {
    id: 'form-1',
    revision: 1,
    projectId: 'project-1',
    profileId: 'profile-1',
    questions,
    purposeByQuestion: {},
    planningReference: 'ref-1',
    maxQuestions: maxQuestions as number
  };
}

test('orçamento é por percurso: ramos mutuamente exclusivos não somam', () => {
  const questions = [
    question('profile', 'single_choice', {
      required: true,
      options: options('a', 'b', 'refuse')
    }),
    question('a_detail', 'text', {
      showWhen: { questionId: 'profile', operator: 'equals', values: ['a'] }
    }),
    question('b_detail', 'text', {
      showWhen: { questionId: 'profile', operator: 'equals', values: ['b'] }
    }),
    question('a_more', 'text', {
      showWhen: { questionId: 'a_detail', operator: 'present' }
    })
  ];

  assert.doesNotThrow(() => validateForm(form(questions, 3)));
  assert.throws(() => validateForm(form(questions, 2)), AppError);
});

test('mudança anterior recalcula visibilidade e ramo oculto não aciona descendente', () => {
  const definition = form(
    [
      question('profile', 'single_choice', {
        required: true,
        options: options('a', 'b', 'refuse')
      }),
      question('a_detail', 'text', {
        showWhen: { questionId: 'profile', operator: 'equals', values: ['a'] }
      }),
      question('b_detail', 'text', {
        showWhen: { questionId: 'profile', operator: 'equals', values: ['b'] }
      }),
      question('a_more', 'text', {
        showWhen: { questionId: 'a_detail', operator: 'present' }
      })
    ],
    3
  );

  const draft: Answers = {
    profile: 'a',
    a_detail: 'detalhe A',
    b_detail: 'sobra de outro ramo',
    a_more: 'descendente'
  };
  const snapshot = { ...draft };

  assert.deepEqual(effectiveAnswers(definition, draft), {
    profile: 'a',
    a_detail: 'detalhe A',
    a_more: 'descendente'
  });
  assert.deepEqual(visibleQuestions(definition, draft).map(item => item.id), [
    'profile',
    'a_detail',
    'a_more'
  ]);
  assert.deepEqual(draft, snapshot);

  const changed: Answers = {
    profile: 'b',
    a_detail: 'detalhe A',
    a_more: 'descendente',
    b_detail: 'detalhe B'
  };
  assert.deepEqual(effectiveAnswers(definition, changed), {
    profile: 'b',
    b_detail: 'detalhe B'
  });
  assert.deepEqual(visibleQuestions(definition, changed).map(item => item.id), ['profile', 'b_detail']);
});

test('pergunta obrigatória oculta não é exigida e resposta inválida oculta é ignorada', () => {
  const definition = form(
    [
      question('profile', 'single_choice', {
        required: true,
        options: options('a', 'b')
      }),
      question('secret', 'single_choice', {
        required: true,
        options: options('x', 'y'),
        showWhen: { questionId: 'profile', operator: 'equals', values: ['a'] }
      })
    ],
    2
  );

  assert.deepEqual(validateSubmission(definition, { profile: 'b' }), { profile: 'b' });
  assert.throws(() => validateSubmission(definition, { profile: 'a' }), AppError);
  assert.deepEqual(validateSubmission(definition, { profile: 'a', secret: 'x' }), {
    profile: 'a',
    secret: 'x'
  });
  assert.deepEqual(validateSubmission(definition, { profile: 'b', secret: 'inexistente' }), {
    profile: 'b'
  });
});

test('texto livre é opcional, só usa presença e permanece dado inerte', () => {
  const definition = form(
    [
      question('note', 'text'),
      question('detail', 'text', {
        showWhen: { questionId: 'note', operator: 'present' }
      })
    ],
    2
  );

  assert.doesNotThrow(() => validateForm(definition));

  const payload = '<script>alert("x")</script>; DROP TABLE answers;';
  assert.deepEqual(validateSubmission(definition, { note: payload, detail: 'ok' }), {
    note: payload,
    detail: 'ok'
  });
  assert.deepEqual(effectiveAnswers(definition, { note: '   ', detail: 'não deve aparecer' }), {});

  assert.throws(
    () => validateForm(form([question('note', 'text', { required: true })], 1)),
    AppError
  );
  assert.throws(
    () => validateForm(form([question('note', 'text', { options: options('a') })], 1)),
    AppError
  );
  assert.throws(
    () =>
      validateForm(
        form(
          [
            question('note', 'text'),
            question('detail', 'text', {
              showWhen: { questionId: 'note', operator: 'equals', values: ['x'] }
            })
          ],
          2
        )
      ),
    AppError
  );
});

test('múltipla seleção usa pertencimento, não igualdade de array', () => {
  const questions = [
    question('topics', 'multiple_choice', { options: options('a', 'b', 'c') }),
    question('b_detail', 'text', {
      showWhen: { questionId: 'topics', operator: 'equals', values: ['b'] }
    }),
    question('c_detail', 'text', {
      showWhen: { questionId: 'topics', operator: 'in', values: ['c'] }
    }),
    question('any_detail', 'text', {
      showWhen: { questionId: 'topics', operator: 'present' }
    })
  ];

  const definition = form(questions, 4);
  assert.doesNotThrow(() => validateForm(definition));
  assert.throws(() => validateForm(form(questions, 3)), AppError);

  assert.deepEqual(visibleQuestions(definition, { topics: ['a', 'b'] }).map(item => item.id), [
    'topics',
    'b_detail',
    'any_detail'
  ]);
  assert.deepEqual(visibleQuestions(definition, { topics: ['c'] }).map(item => item.id), [
    'topics',
    'c_detail',
    'any_detail'
  ]);
  assert.deepEqual(effectiveAnswers(definition, { topics: ['a', 'b'] }), { topics: ['a', 'b'] });
  assert.deepEqual(validateSubmission(definition, { topics: ['b', 'b', 'a'] }), {
    topics: ['b', 'a']
  });
  assert.throws(() => validateSubmission(definition, { topics: ['a', 'inexistente'] }), AppError);
  assert.throws(() => validateSubmission(definition, { topics: 'a' as unknown as string[] }), AppError);
});

test('showWhen recusa referências futuras e autorreferências', () => {
  assert.throws(
    () =>
      validateForm(
        form(
          [
            question('q1', 'text', {
              showWhen: { questionId: 'q2', operator: 'present' }
            }),
            question('q2', 'text')
          ],
          2
        )
      ),
    AppError
  );

  assert.throws(
    () =>
      validateForm(
        form(
          [
            question('q1', 'text', {
              showWhen: { questionId: 'q1', operator: 'present' }
            })
          ],
          1
        )
      ),
    AppError
  );
});

test('ids de pergunta e de opção são únicos no escopo correto', () => {
  assert.throws(
    () => validateForm(form([question('same', 'text'), question('same', 'text')], 2)),
    AppError
  );

  assert.throws(
    () =>
      validateForm(
        form([question('choice', 'single_choice', { options: options('a', 'a') })], 1)
      ),
    AppError
  );

  assert.doesNotThrow(() =>
    validateForm(
      form(
        [
          question('first', 'single_choice', { options: options('same-option') }),
          question('second', 'single_choice', { options: options('same-option') })
        ],
        2
      )
    )
  );
});

test('equals, in e present têm forma e valores verificáveis', () => {
  function withCondition(condition: Condition): FormDefinition {
    return form(
      [
        question('ref', 'single_choice', { options: options('a', 'b') }),
        question('target', 'text', { showWhen: condition })
      ],
      2
    );
  }

  assert.throws(
    () => validateForm(withCondition({ questionId: 'ref', operator: 'equals', values: [] })),
    AppError
  );
  assert.throws(
    () => validateForm(withCondition({ questionId: 'ref', operator: 'equals', values: ['a', 'b'] })),
    AppError
  );
  assert.throws(
    () => validateForm(withCondition({ questionId: 'ref', operator: 'in', values: [] })),
    AppError
  );
  assert.throws(
    () => validateForm(withCondition({ questionId: 'ref', operator: 'in', values: ['z'] })),
    AppError
  );
  assert.throws(
    () => validateForm(withCondition({ questionId: 'ref', operator: 'present', values: ['a'] })),
    AppError
  );
  assert.throws(
    () =>
      validateForm(
        withCondition({
          questionId: 'ref',
          operator: 'contains' as unknown as 'equals',
          values: ['a']
        })
      ),
    AppError
  );

  assert.doesNotThrow(() =>
    validateForm(withCondition({ questionId: 'ref', operator: 'equals', values: ['a'] }))
  );
  assert.doesNotThrow(() =>
    validateForm(withCondition({ questionId: 'ref', operator: 'in', values: ['a', 'b'] }))
  );
});

test('orçamento excessivo é detectado e o padrão de produto é seis', () => {
  const sharedPath = [
    question('gate', 'single_choice', { options: options('a', 'b') }),
    question('d1', 'text', {
      showWhen: { questionId: 'gate', operator: 'equals', values: ['a'] }
    }),
    question('d2', 'text', {
      showWhen: { questionId: 'gate', operator: 'equals', values: ['a'] }
    }),
    question('d3', 'text', {
      showWhen: { questionId: 'gate', operator: 'equals', values: ['a'] }
    })
  ];

  assert.doesNotThrow(() => validateForm(form(sharedPath, 4)));
  assert.throws(() => validateForm(form(sharedPath, 3)), AppError);

  const sevenSimple = Array.from({ length: 7 }, (_, index) => question(`q${index}`, 'text'));
  assert.throws(() => validateForm(form(sevenSimple, undefined)), AppError);
  assert.doesNotThrow(() => validateForm(form(sevenSimple.slice(0, 6), undefined)));
});

test('limites de maxQuestions, total de perguntas e familiarityReferences', () => {
  assert.throws(() => validateForm(form([question('q', 'text')], 0)), AppError);
  assert.throws(() => validateForm(form([question('q', 'text')], 33)), AppError);
  assert.throws(() => validateForm(form([question('q', 'text')], 1.5)), AppError);
  assert.doesNotThrow(() => validateForm(form([question('q', 'text')], 1)));

  const tooMany = Array.from({ length: 65 }, (_, index) => question(`q${index}`, 'text'));
  assert.throws(() => validateForm(form(tooMany, 32)), AppError);

  assert.doesNotThrow(() =>
    validateForm(
      form([question('known', 'text', { familiarityReferences: ['a', 'b', 'c'] })], 1)
    )
  );
  assert.throws(
    () =>
      validateForm(
        form([question('known', 'text', { familiarityReferences: ['a', 'b', 'c', 'd'] })], 1)
      ),
    AppError
  );
  assert.throws(
    () =>
      validateForm(
        form(
          [question('known', 'text', { familiarityReferences: ['a', 1 as unknown as string] })],
          1
        )
      ),
    AppError
  );
});

test('submissão exige só obrigatórias visíveis, aceita recusa e rejeita resposta ativa inválida', () => {
  const definition = form(
    [
      question('confirm', 'single_choice', {
        required: true,
        options: options('yes', 'no', 'refuse')
      }),
      question('why', 'text', {
        showWhen: { questionId: 'confirm', operator: 'equals', values: ['no'] }
      })
    ],
    2
  );

  assert.deepEqual(validateSubmission(definition, { confirm: 'refuse' }), { confirm: 'refuse' });
  assert.deepEqual(validateSubmission(definition, { confirm: 'no', why: 'porque sim' }), {
    confirm: 'no',
    why: 'porque sim'
  });
  assert.throws(() => validateSubmission(definition, {}), AppError);
  assert.throws(() => validateSubmission(definition, { confirm: 'talvez' }), AppError);
  assert.throws(() => validateSubmission(definition, { confirm: 123 as unknown as string }), AppError);
  assert.throws(
    () => validateSubmission(definition, { confirm: 'no', why: ['x'] as unknown as string }),
    AppError
  );
  assert.deepEqual(validateSubmission(definition, { confirm: 'yes', why: ['x'] as unknown as string }), {
    confirm: 'yes'
  });
});
