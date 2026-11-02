import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LibraryEntity, LibraryRelation } from '../src/contracts.ts';
import {
  documentedLocations,
  filterLibrary,
  graphPage,
  mergeEntities,
  renameLabel,
  splitEntity,
} from '../src/library.ts';

function entity(
  id: string,
  kind: LibraryEntity['kind'],
  labels: Record<string, string>,
  extra: Partial<LibraryEntity> = {},
): LibraryEntity {
  return {
    id,
    kind,
    labels,
    aliases: [],
    authorIds: [],
    regions: [],
    traditions: [],
    disciplines: [],
    periods: [],
    dates: { start: null, end: null, approximate: false },
    locations: [],
    metadata: {},
    ...extra,
  };
}

function relation(
  id: string,
  from: string,
  to: string,
  type: LibraryRelation['type'],
  evidence: string[],
): LibraryRelation {
  return { id, from, to, type, evidence };
}

const alencar = entity('a', 'author', { pt: 'José de Alencar', en: 'Jose de Alencar' }, {
  aliases: ['Alencar'],
  regions: ['Brasil'],
  traditions: ['romantismo'],
  dates: { start: 1829, end: 1877, approximate: false },
});
const iracema = entity('b', 'work', { pt: 'Iracema', en: 'Iracema' }, {
  aliases: ['lenda'],
  authorIds: ['a'],
  regions: ['Brasil'],
  traditions: ['romantismo'],
  disciplines: ['literatura'],
  periods: ['romantismo'],
  dates: { start: 1865, end: 1865, approximate: false },
});
const guarani = entity('c', 'work', { pt: 'O Guarani' }, {
  authorIds: ['a'],
  regions: ['Brasil'],
  traditions: ['romantismo'],
});
const outro = entity('d', 'work', { pt: 'Outro' }, {
  regions: ['Europa'],
  traditions: ['realismo'],
  dates: { start: 1900, end: null, approximate: false },
});

describe('filterLibrary', () => {
  it('combina OR na dimensão, AND entre dimensões e busca sem acento', () => {
    const andResult = filterLibrary([alencar, iracema, guarani, outro], {
      regions: ['Brasil'],
      traditions: ['realismo', 'romantismo'],
      authorIds: ['a'],
    });
    assert.equal(andResult.total, 2);
    assert.deepEqual(andResult.items.map(item => item.id).sort(), ['b', 'c']);

    assert.deepEqual(filterLibrary([alencar, iracema, guarani, outro], { query: 'jose' }).items.map(item => item.id), ['a']);
    assert.equal(filterLibrary([alencar, iracema, guarani, outro], { query: 'ALENCAR' }).total, 1);
    assert.equal(filterLibrary([alencar, iracema, guarani, outro], { kinds: ['author', 'concept'] }).total, 1);
  });

  it('filtra idioma, datas inclusivas sem inventar ausentes e pagina até 100', () => {
    assert.equal(filterLibrary([alencar, iracema, guarani, outro], { language: 'en' }).total, 2);
    const dated = filterLibrary([alencar, iracema, guarani, outro], { fromYear: 1865, toYear: 1865 });
    assert.deepEqual(dated.items.map(item => item.id).sort(), ['a', 'b']);

    const page = filterLibrary([alencar, iracema, guarani, outro], { offset: 1, limit: 1 });
    assert.equal(page.total, 4);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].id, 'a');

    assert.ok(filterLibrary([alencar, iracema, guarani, outro], { limit: 500 }).items.length <= 100);
    assert.throws(() => filterLibrary([alencar], { limit: 0 }));
    assert.throws(() => filterLibrary([alencar], { fromYear: 1900, toYear: 1800 }));
  });
});

describe('documentedLocations', () => {
  it('retorna apenas locais geográficos válidos com evidência e papéis distintos', () => {
    const place = entity('p', 'place', { pt: 'Lisboa' }, {
      traditions: ['portuguesa'],
      locations: [
        { lat: 38.7, lon: -9.1, role: 'birth', evidence: 'certidão' },
        { lat: 38.7, lon: -9.1, role: 'activity', evidence: 'crônica' },
        { lat: 999, lon: 0, role: 'birth', evidence: 'coordenada inválida' },
        { lat: 0, lon: 0, role: 'composition', evidence: '   ' },
      ],
    });
    const inferredButUnlocated = entity('u', 'author', { pt: 'Autor' }, {
      regions: ['Brasil'],
      traditions: ['romantismo'],
    });
    const result = documentedLocations([place, inferredButUnlocated]);
    assert.equal(result.length, 2);
    assert.deepEqual(result.map(item => item.role), ['birth', 'activity']);
    assert.ok(result.every(item => item.evidence.trim().length > 0));
  });
});

describe('graphPage', () => {
  it('inclui arestas incidentes, retorna extremos da página e legenda real', () => {
    const nodes = [alencar, iracema, guarani];
    const relations = [
      relation('r1', 'a', 'b', 'influence', ['fonte 1']),
      relation('r2', 'b', 'c', 'reception', ['fonte 2']),
      relation('r3', 'a', 'c', 'affinity', ['   ']),
      relation('r4', 'a', 'inexistente', 'influence', ['fonte 4']),
    ];

    const first = graphPage(nodes, relations, ['b'], 0, 1);
    assert.equal(first.total, 2);
    assert.equal(first.edges.length, 1);
    assert.equal(first.edges[0].id, 'r1');
    assert.deepEqual(first.nodes.map(node => node.id).sort(), ['a', 'b']);
    assert.deepEqual(first.legend, ['influence']);

    const second = graphPage(nodes, relations, ['b'], 1, 1);
    assert.equal(second.edges[0].id, 'r2');
    assert.deepEqual(second.nodes.map(node => node.id).sort(), ['b', 'c']);
    assert.deepEqual(second.legend, ['reception']);

    const all = graphPage(nodes, relations, ['a', 'b', 'c', 'a'], 0, 10);
    assert.equal(all.total, 2);
    assert.equal(all.edges.length, 2);
    assert.deepEqual(all.nodes.map(node => node.id).sort(), ['a', 'b', 'c']);
    assert.deepEqual(all.legend, ['influence', 'reception']);
    assert.throws(() => graphPage(nodes, relations, ['desconhecido'], 0, 10));
  });
});

describe('renameLabel', () => {
  it('conserva rótulo anterior como alias sem mudar id ou outros idiomas', () => {
    const renamed = renameLabel(alencar, 'pt', 'José Martiniano de Alencar');
    assert.equal(renamed.id, 'a');
    assert.equal(renamed.labels.pt, 'José Martiniano de Alencar');
    assert.equal(renamed.labels.en, 'Jose de Alencar');
    assert.ok(renamed.aliases.includes('José de Alencar'));
    assert.ok(renamed.aliases.includes('Alencar'));
    assert.equal(alencar.labels.pt, 'José de Alencar');
  });
});

describe('mergeEntities', () => {
  it('funde, redireciona referências em todas as entidades e não muta a entrada', () => {
    const first = entity('a', 'author', { pt: 'Alfa' }, {
      aliases: ['A1'],
      regions: ['Norte'],
      metadata: { nota: 'primeira' },
    });
    const second = entity('b', 'author', { en: 'Beta' }, {
      aliases: ['B1'],
      regions: ['Sul'],
      metadata: { nota: 'segunda' },
    });
    const target = entity('t', 'author', { pt: 'Alvo' }, {
      regions: ['Centro'],
      metadata: { nota: 'alvo' },
    });
    const work = entity('w', 'work', { pt: 'Obra' }, {
      authorIds: ['a'],
      traditions: ['a', 'outra'],
    });
    const relations = [
      relation('r1', 'a', 'w', 'influence', ['e1']),
      relation('r2', 'b', 'w', 'influence', ['e2']),
      relation('r3', 'a', 'b', 'influence', ['e3']),
    ];
    const inputSnapshot = JSON.stringify({ entities: [first, second, target, work], relations });

    const result = mergeEntities([first, second, target, work], relations, ['a', 'b'], 't');
    const merged = result.entities.find(item => item.id === 't')!;
    const mergedWork = result.entities.find(item => item.id === 'w')!;
    assert.deepEqual(result.entities.map(item => item.id).sort(), ['t', 'w']);
    assert.deepEqual(result.redirects, { a: 't', b: 't' });
    assert.equal(merged.labels.pt, 'Alvo');
    assert.equal(merged.labels.en, 'Beta');
    assert.ok(['A1', 'B1', 'Alfa'].every(alias => merged.aliases.includes(alias)));
    assert.ok(['Centro', 'Norte', 'Sul'].every(region => merged.regions.includes(region)));
    assert.deepEqual(Object.keys(merged.metadata.mergedFrom as Record<string, unknown>).sort(), ['a', 'b']);
    assert.deepEqual(mergedWork.authorIds, ['t']);
    assert.deepEqual(mergedWork.traditions, ['t', 'outra']);
    assert.equal(result.relations.length, 1);
    assert.equal(result.relations[0].from, 't');
    assert.equal(result.relations[0].to, 'w');
    assert.deepEqual([...result.relations[0].evidence].sort(), ['e1', 'e2']);

    assert.equal(JSON.stringify({ entities: [first, second, target, work], relations }), inputSnapshot);
    assert.deepEqual(work.authorIds, ['a']);
    assert.equal(target.metadata.mergedFrom, undefined);
  });

  it('recusa alvo dentro das origens e espécies diferentes', () => {
    const author = entity('a', 'author', { pt: 'A' });
    const author2 = entity('b', 'author', { pt: 'B' });
    const work = entity('w', 'work', { pt: 'W' });
    assert.throws(() => mergeEntities([author, author2], [], ['a'], 'a'));
    assert.throws(() => mergeEntities([author, work], [], ['w'], 'a'));
  });
});

describe('splitEntity', () => {
  it('distribui referências somente com destinos explícitos e guarda a origem', () => {
    const source = entity('a', 'author', { pt: 'Autor' });
    const x = entity('x', 'author', { pt: 'X' });
    const y = entity('y', 'author', { pt: 'Y' });
    const work = entity('w', 'work', { pt: 'Obra' }, { authorIds: ['a'] });
    const concept = entity('c', 'concept', { pt: 'Conceito' }, { authorIds: ['a', 'outro'] });
    const relations = [
      relation('r1', 'a', 'w', 'influence', ['e1']),
      relation('r2', 'c', 'a', 'criticism', ['e2']),
      relation('r3', 'w', 'c', 'affinity', ['e3']),
    ];
    const assignments = { w: 'x', c: 'y', r1: 'x', r2: 'y' };
    const result = splitEntity([source, work, concept], relations, 'a', [x, y], assignments);

    assert.equal(result.entities.some(item => item.id === 'a'), false);
    assert.equal(result.entities.find(item => item.id === 'x')!.metadata.splitFrom, 'a');
    assert.deepEqual(result.entities.find(item => item.id === 'w')!.authorIds, ['x']);
    assert.deepEqual(result.entities.find(item => item.id === 'c')!.authorIds, ['y', 'outro']);
    assert.equal(result.relations.find(item => item.id === 'r1')!.from, 'x');
    assert.equal(result.relations.find(item => item.id === 'r2')!.to, 'y');
    assert.deepEqual(result.relations.find(item => item.id === 'r3'), relations[2]);
  });

  it('recusa dependência ou substituto sem escolha, id existente ou espécie diferente', () => {
    const source = entity('a', 'author', { pt: 'Autor' });
    const x = entity('x', 'author', { pt: 'X' });
    const z = entity('z', 'concept', { pt: 'Z' });
    const replacementWithReference = entity('n', 'author', { pt: 'N' }, { authorIds: ['a'] });
    const work = entity('w', 'work', { pt: 'Obra' }, { authorIds: ['a'] });
    const relations = [relation('r1', 'a', 'w', 'influence', ['e1'])];
    assert.throws(() => splitEntity([source, work], relations, 'a', [x], { w: 'x' }));
    assert.throws(() => splitEntity([source, work], relations, 'a', [work], { w: 'w', r1: 'w' }));
    assert.throws(() => splitEntity([source, work], relations, 'a', [z], { w: 'z', r1: 'z' }));
    assert.throws(() => splitEntity([source, work], relations, 'a', [replacementWithReference], {
      w: 'n',
      r1: 'n',
    }));
  });
});
