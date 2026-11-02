import { escapeHtml, iconButton, type StudyApi } from './dom.ts';
import './explore-view.css';
import type { LibraryEntity, LibraryRelation } from '../contracts.ts';

const PAGE_SIZE = 30;
const GRAPH_PAGE_SIZE = 30;
const GRAPH_ID_LIMIT = 100;

const KIND_LABELS: Record<string, string> = {
  author: 'Autor',
  work: 'Obra',
  edition: 'Edição',
  concept: 'Conceito',
  place: 'Lugar',
  period: 'Período',
  tradition: 'Tradição',
  discipline: 'Disciplina',
  art: 'Arte',
};
const KIND_OPTIONS = Object.keys(KIND_LABELS);

const ROLE_LABELS: Record<string, string> = {
  birth: 'Nascimento',
  activity: 'Atividade',
  composition: 'Composição',
  conservation: 'Conservação',
};
const ROLES = ['birth', 'activity', 'composition', 'conservation'];

const REL_LABELS: Record<string, string> = {
  influence: 'Influência',
  reception: 'Recepção',
  criticism: 'Crítica',
  opposition: 'Oposição',
  continuity: 'Continuidade',
  affinity: 'Afinidade',
  broader: 'Mais amplo',
  exactMatch: 'Correspondência exata',
  closeMatch: 'Correspondência próxima',
};

const REL_CLASS: Record<string, string> = {
  influence: 'rel-influence',
  reception: 'rel-reception',
  criticism: 'rel-criticism',
  opposition: 'rel-opposition',
  continuity: 'rel-continuity',
  affinity: 'rel-affinity',
  broader: 'rel-broader',
  exactMatch: 'rel-exactMatch',
  closeMatch: 'rel-closeMatch',
};

type Mode = 'list' | 'map' | 'graph';
type FilterDim = 'kinds' | 'regions' | 'periods' | 'traditions' | 'disciplines' | 'authorIds';
type FacetDim = Exclude<FilterDim, 'kinds'>;

type PageData = { items?: unknown; total?: unknown };
type MapData = PageData & { locations?: unknown };
type GraphData = { nodes?: unknown; edges?: unknown; total?: unknown; legend?: unknown };

type DocumentedLocation = {
  entityId: string;
  label: string;
  lat: number;
  lon: number;
  role: string;
  evidence: string;
  dates?: string;
};

type Facets = Record<FacetDim, LibraryEntity[]>;

const FACET_DIMS: { dim: FacetDim; kind: string; title: string }[] = [
  { dim: 'regions', kind: 'place', title: 'Região' },
  { dim: 'periods', kind: 'period', title: 'Período cultural' },
  { dim: 'traditions', kind: 'tradition', title: 'Tradição' },
  { dim: 'disciplines', kind: 'discipline', title: 'Disciplina' },
  { dim: 'authorIds', kind: 'author', title: 'Autor' },
];

const FILTER_DIMS: FilterDim[] = [
  'kinds',
  'regions',
  'periods',
  'traditions',
  'disciplines',
  'authorIds',
];

function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

const numOr0 = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const round = (value: number): string => String(Math.round(value * 100) / 100);
const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

function isAbort(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError';
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Erro desconhecido.';
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Operação cancelada.', 'AbortError'));
      return;
    }
    const onAbort = () => reject(new DOMException('Operação cancelada.', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function isPortuguese(language: string): boolean {
  const value = language.toLowerCase();
  return value === 'pt' || value.startsWith('pt-');
}

function labelInfo(entity: LibraryEntity): { text: string; language: string } {
  const entries = Object.entries(entity?.labels ?? {}).filter(
    ([, value]) => typeof value === 'string' && value.trim().length > 0,
  );
  const portuguese = entries.find(([language]) => isPortuguese(language));
  const chosen = portuguese ?? [...entries].sort(([a], [b]) => a.localeCompare(b))[0];
  if (!chosen) return { text: typeof entity?.id === 'string' ? entity.id : 'Entidade', language: '' };
  return { text: chosen[1].trim(), language: chosen[0] };
}

function metadataText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function safeLocalImage(value: string): string | null {
  const path = value.trim();
  if (!path.startsWith('art/')) return null;
  if (path.includes('..') || path.includes('\\') || path.startsWith('/')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  return path;
}

function formatYear(value: number): string {
  if (!Number.isFinite(value)) return '?';
  if (value < 0) return `${Math.abs(value)} a.C.`;
  return String(value);
}

function formatDates(dates: LibraryEntity['dates'] | null | undefined): string {
  if (!dates) return 'Datas não informadas';
  const parts: string[] = [];
  if (dates.start !== null && dates.end !== null) {
    parts.push(
      dates.start === dates.end
        ? formatYear(dates.start)
        : `${formatYear(dates.start)}–${formatYear(dates.end)}`,
    );
  } else if (dates.start !== null) {
    parts.push(`a partir de ${formatYear(dates.start)}`);
  } else if (dates.end !== null) {
    parts.push(`até ${formatYear(dates.end)}`);
  } else {
    parts.push('Datas não informadas');
  }
  if (dates.approximate) parts.push('(aproximada)');
  if (dates.original) parts.push(`original: ${dates.original}`);
  return parts.join(' ');
}

function geojsonPaths(geo: unknown): string[] {
  const output: string[] = [];

  const ringPath = (ring: unknown): string => {
    if (!Array.isArray(ring)) return '';
    const points: string[] = [];
    for (const point of ring) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const lon = Number(point[0]);
      const lat = Number(point[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      points.push(`${round(lon + 180)} ${round(90 - lat)}`);
    }
    return points.length >= 3 ? `M${points.join('L')}Z` : '';
  };

  const polygonPath = (polygon: unknown): string =>
    Array.isArray(polygon) ? polygon.map(ringPath).filter(Boolean).join('') : '';

  const addGeometry = (geometry: unknown): void => {
    if (!geometry || typeof geometry !== 'object') return;
    const data = geometry as { type?: unknown; coordinates?: unknown };
    if (data.type === 'Polygon') {
      const path = polygonPath(data.coordinates);
      if (path) output.push(path);
    } else if (data.type === 'MultiPolygon' && Array.isArray(data.coordinates)) {
      for (const polygon of data.coordinates) {
        const path = polygonPath(polygon);
        if (path) output.push(path);
      }
    }
  };

  if (geo && typeof geo === 'object') {
    const data = geo as { features?: unknown };
    if (Array.isArray(data.features)) {
      for (const feature of data.features) {
        if (feature && typeof feature === 'object') {
          addGeometry((feature as { geometry?: unknown }).geometry);
        }
      }
    } else {
      addGeometry(geo);
    }
  }
  return output;
}

function markerShape(role: string, x: number, y: number): string {
  if (role === 'activity') {
    return `<rect x="${round(x - 3)}" y="${round(y - 3)}" width="6" height="6" rx="1"></rect>`;
  }
  if (role === 'composition') {
    return `<polygon points="${round(x)},${round(y - 4)} ${round(x + 4)},${round(y + 3)} ${round(x - 4)},${round(y + 3)}"></polygon>`;
  }
  if (role === 'conservation') {
    return `<polygon points="${round(x)},${round(y - 4)} ${round(x + 4)},${round(y)} ${round(x)},${round(y + 4)} ${round(x - 4)},${round(y)}"></polygon>`;
  }
  return `<circle cx="${round(x)}" cy="${round(y)}" r="3"></circle>`;
}

export async function mountExplore(root: HTMLElement, api: StudyApi): Promise<() => void> {
  const section = document.createElement('section');
  section.className = 'explore-view';
  section.setAttribute('aria-label', 'Explorar acervo');

  const state = {
    mode: 'list' as Mode,
    query: '',
    kinds: [] as string[],
    regions: [] as string[],
    periods: [] as string[],
    traditions: [] as string[],
    disciplines: [] as string[],
    authorIds: [] as string[],
    fromYear: '',
    toYear: '',
    offset: 0,
    graphOffset: 0,
  };

  const labels = new Map<string, string>();
  let facets: Facets = { regions: [], periods: [], traditions: [], disciplines: [], authorIds: [] };
  let facetsError = '';

  let seq = 0;
  let recordSeq = 0;
  let apiController: AbortController | null = null;
  let recordController: AbortController | null = null;
  let facetController: AbortController | null = null;
  let mapController: AbortController | null = null;
  let searchTimer: number | null = null;

  let landPaths: string[] | null = null;
  let landError = '';
  let landLoading: Promise<void> | null = null;
  let lastMapData: MapData | null = null;

  let mapZoom = 1;
  let mapPanX = 0;
  let mapPanY = 0;

  let lastRecordTrigger: Element | null = null;

  section.innerHTML = `
    <header class="explore-toolbar">
      <div class="explore-modes" role="group" aria-label="Modo de visualização">
        ${iconButton('book-text', 'Lista', 'mode', 'data-mode="list" aria-pressed="true"')}
        ${iconButton('intent', 'Mapa', 'mode', 'data-mode="map" aria-pressed="false"')}
        ${iconButton('graph', 'Rede', 'mode', 'data-mode="graph" aria-pressed="false"')}
      </div>
      <label class="explore-search">
        <span class="explore-search-label">Buscar no acervo</span>
        <input type="search" data-search autocomplete="off" placeholder="Nome, alias…" aria-label="Buscar no acervo" />
      </label>
    </header>
    <details class="explore-filter-panel">
      <summary>Filtros <span class="explore-filter-count" data-filter-count>0 ativos</span></summary>
      <div class="explore-filter-body" data-filters><p class="explore-muted">Carregando categorias…</p></div>
    </details>
    <p class="explore-status" role="status" data-status></p>
    <div class="explore-record-slot"></div>
    <div class="explore-content" data-content></div>
  `;

  root.append(section);

  const content = (): HTMLElement | null =>
    section.querySelector<HTMLElement>('[data-content]');
  const recordSlot = (): HTMLElement | null =>
    section.querySelector<HTMLElement>('.explore-record-slot');

  function setStatus(message: string): void {
    const status = section.querySelector<HTMLElement>('[data-status]');
    if (status) status.textContent = message;
  }

  function remember(entity: LibraryEntity): void {
    if (!entity || typeof entity.id !== 'string') return;
    labels.set(entity.id, labelInfo(entity).text);
  }

  function rememberAll(value: unknown): void {
    for (const item of arr<unknown>(value)) {
      if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
        remember(item as LibraryEntity);
      }
    }
  }

  function joinIds(ids: string[] | undefined): string {
    if (!ids || ids.length === 0) return '';
    return ids.map(id => labels.get(id) ?? id).join(', ');
  }

  function kindLabel(kind: string): string {
    return KIND_LABELS[kind] ?? kind;
  }

  function roleLabel(role: string): string {
    return ROLE_LABELS[role] ?? role;
  }

  function authorshipText(entity: LibraryEntity): string {
    const names = (entity.authorIds ?? []).map(id => labels.get(id) ?? id);
    if (entity.authorship === 'unknown') return 'Autoria desconhecida (registro explícito)';
    if (entity.authorship === 'attributed') {
      return `Autoria atribuída${names.length ? `: ${names.join(', ')}` : ' (responsável não informado)'}`;
    }
    if (entity.authorship === 'multiple' || names.length > 1) {
      return `Autoria múltipla${names.length ? `: ${names.join(', ')}` : ' (autores não informados)'}`;
    }
    if (entity.authorship === 'collective') {
      return `Autoria coletiva${names.length ? `: ${names.join(', ')}` : ' (responsáveis não informados)'}`;
    }
    if (entity.authorship === 'individual') {
      return `Autoria individual${names.length ? `: ${names.join(', ')}` : ' (nome não informado)'}`;
    }
    if (names.length === 1) return `Autoria: ${names[0]}`;
    if (entity.kind === 'work' || entity.kind === 'art' || entity.kind === 'edition') {
      return 'Autoria desconhecida (campo não informado)';
    }
    return 'Autoria não se aplica';
  }

  function cardHtml(entity: LibraryEntity): string {
    remember(entity);
    const info = labelInfo(entity);
    const badges = [
      `<span class="explore-badge">${escapeHtml(kindLabel(entity.kind))}</span>`,
    ];
    if (info.language && !isPortuguese(info.language)) {
      badges.push(`<span class="explore-lang">${escapeHtml(info.language)}</span>`);
    }
    const lines: string[] = [];
    if (['work', 'art', 'edition'].includes(entity.kind)) {
      lines.push(authorshipText(entity));
    }
    lines.push(formatDates(entity.dates));
    const regions = joinIds(entity.regions);
    const traditions = joinIds(entity.traditions);
    const disciplines = joinIds(entity.disciplines);
    const periods = joinIds(entity.periods);
    const extras: string[] = [];
    if (regions) extras.push(`Regiões: ${regions}`);
    if (traditions) extras.push(`Tradições: ${traditions}`);
    if (disciplines) extras.push(`Disciplinas: ${disciplines}`);
    if (periods) extras.push(`Períodos: ${periods}`);
    if (extras.length) lines.push(extras.join(' · '));

    return `<li>
      <button type="button" class="explore-card" data-action="open" data-id="${escapeHtml(entity.id)}" aria-label="Abrir ficha de ${escapeHtml(info.text)}">
        <span class="explore-card-title">${escapeHtml(info.text)}</span>
        <span class="explore-card-meta">${badges.join(' ')}</span>
        ${lines.map(line => `<span class="explore-card-line">${escapeHtml(line)}</span>`).join('')}
      </button>
    </li>`;
  }

  function pagerHtml(total: number, offset: number, baseName: string): string {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(pages, Math.floor(offset / PAGE_SIZE) + 1);
    return `<div class="explore-result-head">
      <p class="explore-result-count">${total} resultado(s) · página ${page} de ${pages}</p>
      <div class="explore-pager" role="group" aria-label="Paginação de ${baseName}">
        ${iconButton('arrow-left', 'Página anterior', 'page-prev', offset <= 0 ? 'disabled' : '')}
        ${iconButton('arrow-right', 'Próxima página', 'page-next', offset + PAGE_SIZE >= total ? 'disabled' : '')}
      </div>
    </div>`;
  }

  function renderList(data: PageData): void {
    const target = content();
    if (!target) return;
    const items = arr<LibraryEntity>(data.items);
    const total = numOr0(data.total);
    rememberAll(items);
    target.innerHTML = `${pagerHtml(total, state.offset, 'resultados')}
      ${items.length ? `<ul class="explore-list">${items.map(cardHtml).join('')}</ul>` : '<p class="explore-empty">Nenhuma entidade corresponde aos filtros.</p>'}`;
  }

  function mapSvgHtml(locations: DocumentedLocation[], items: LibraryEntity[]): string {
    if (!landPaths) {
      if (landError) {
        return `<p class="explore-error" role="alert">Base vetorial local indisponível: ${escapeHtml(landError)}. Nenhum mapa substituto foi desenhado.</p>`;
      }
      return '<p class="explore-muted">Carregando base vetorial local…</p>';
    }

    const itemById = new Map(items.map(item => [item.id, item]));
    const markers = locations.map(location => {
      const role = ROLES.includes(location.role) ? location.role : 'activity';
      const label = labels.get(location.entityId) ?? location.label ?? location.entityId;
      const x = location.lon + 180;
      const y = 90 - location.lat;
      const date = location.dates ?? formatDates(itemById.get(location.entityId)?.dates);
      const title = `${label} — ${roleLabel(role)} — ${date} — ${location.evidence}`;
      return `<g class="explore-marker explore-marker-${role}" role="button" tabindex="0" data-action="open" data-id="${escapeHtml(location.entityId)}" aria-label="${escapeHtml(`Abrir ficha de ${label}, local de ${roleLabel(role).toLowerCase()}: ${location.evidence}`)}">
        <title>${escapeHtml(title)}</title>
        <circle class="explore-hit" cx="${round(x)}" cy="${round(y)}" r="24" aria-hidden="true"></circle>
        ${markerShape(role, x, y)}
      </g>`;
    });

    return `<div class="explore-map-wrap">
      <svg class="explore-map" viewBox="0 0 360 180" role="group" aria-label="Mapa vetorial equiretangular de terras com ${locations.length} local(is) documentado(s)" tabindex="0" data-map>
        <g data-map-layer>
          ${landPaths.map(path => `<path class="explore-land" d="${escapeHtml(path)}" fill-rule="evenodd"></path>`).join('')}
          ${markers.join('')}
        </g>
      </svg>
    </div>
    <div class="explore-legend" aria-label="Legenda de papéis dos locais">
      <span class="explore-legend-title">Papéis:</span>
      ${ROLES.map(role => `<span class="explore-legend-item"><span class="explore-shape explore-shape-${role}" aria-hidden="true">${role === 'activity' ? '■' : role === 'composition' ? '▲' : role === 'conservation' ? '◆' : '●'}</span>${roleLabel(role)}</span>`).join('')}
    </div>
    <div class="explore-map-controls" role="group" aria-label="Controles do mapa">
      ${iconButton('add', 'Aproximar', 'map-zoom-in')}
      ${iconButton('remove-state', 'Afastar', 'map-zoom-out')}
      ${iconButton('reset', 'Recentralizar', 'map-reset')}
      ${iconButton('arrow-left', 'Mover para oeste', 'map-pan-left')}
      ${iconButton('arrow-right', 'Mover para leste', 'map-pan-right')}
      ${iconButton('arrow-up', 'Mover para o norte', 'map-pan-up')}
      ${iconButton('arrow-down', 'Mover para o sul', 'map-pan-down')}
    </div>
    <p class="explore-note">Mapa de terras sem fronteiras políticas. Base: <a href="https://www.naturalearthdata.com/about/terms-of-use/" rel="noreferrer" target="_blank">Natural Earth</a> (domínio público).</p>`;
  }

  function locationListHtml(locations: DocumentedLocation[], items: LibraryEntity[]): string {
    const itemById = new Map(items.map(item => [item.id, item]));
    const entries = locations.map(location => {
      const entity = itemById.get(location.entityId);
      const label = labels.get(location.entityId) ?? location.label ?? location.entityId;
      const role = ROLES.includes(location.role) ? location.role : 'activity';
      const dates = location.dates ?? (entity ? formatDates(entity.dates) : 'Datas não informadas');
      const approximate = !!entity?.dates?.approximate;
      return `<li class="explore-location">
        <button type="button" class="explore-location-open" data-action="open" data-id="${escapeHtml(location.entityId)}">Abrir ficha de ${escapeHtml(label)}</button>
        <p><span class="explore-badge">${escapeHtml(roleLabel(role))}</span> ${escapeHtml(`${location.lat}, ${location.lon}`)}</p>
        <p class="explore-evidence">Evidência: ${escapeHtml(location.evidence)}</p>
        <p class="explore-meta">Datas: ${escapeHtml(dates)}${approximate ? ' · datação aproximada' : ''}</p>
      </li>`;
    });
    return `<ul class="explore-location-list">${entries.join('')}</ul>`;
  }

  function renderMap(data: MapData): void {
    const target = content();
    if (!target) return;
    lastMapData = data;
    const items = arr<LibraryEntity>(data.items);
    const total = numOr0(data.total);
    const locations = arr<DocumentedLocation>(data.locations).filter(
      location =>
        location &&
        typeof location.entityId === 'string' &&
        Number.isFinite(location.lat) &&
        Number.isFinite(location.lon) &&
        typeof location.evidence === 'string' &&
        location.evidence.trim().length > 0,
    );
    rememberAll(items);
    for (const location of locations) {
      labels.set(location.entityId, location.label || labels.get(location.entityId) || location.entityId);
    }

    target.innerHTML = `${pagerHtml(total, state.offset, 'resultados do mapa')}
      <p class="explore-note">Os locais documentados nesta página aparecem no mapa e na lista abaixo.</p>
      ${mapSvgHtml(locations, items)}
      ${locations.length ? locationListHtml(locations, items) : '<p class="explore-empty">Nenhum local documentado nesta página.</p>'}`;
    applyMapTransform();
  }

  function graphLayout(nodes: LibraryEntity[]): Map<string, { x: number; y: number }> {
    const count = Math.max(nodes.length, 1);
    const cx = 180;
    const cy = 130;
    const radius = count === 1 ? 0 : 96;
    const positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
      positions.set(node.id, {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    });
    return positions;
  }

  function relationTypeClass(type: string): string {
    return REL_CLASS[type] ?? 'rel-affinity';
  }

  function renderGraph(data: GraphData, filteredCount: number, filteredTotal: number): void {
    const target = content();
    if (!target) return;
    const allNodes = arr<LibraryEntity>(data.nodes);
    const edges = arr<LibraryRelation>(data.edges);
    const endpoints=new Set(edges.flatMap(edge=>[edge.from,edge.to]));
    const nodes=edges.length?allNodes.filter(node=>endpoints.has(node.id)):allNodes.slice(0,12);
    const total = numOr0(data.total);
    rememberAll(nodes);
    const positions = graphLayout(nodes);
    const pages = Math.max(1, Math.ceil(total / GRAPH_PAGE_SIZE));
    const page = Math.min(pages, Math.floor(state.graphOffset / GRAPH_PAGE_SIZE) + 1);
    const presentTypes = Array.from(new Set(edges.map(edge => edge.type)));

    const edgeSvg = edges
      .map(edge => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to || edge.from === edge.to) return '';
        return `<line class="explore-edge ${relationTypeClass(edge.type)}" x1="${round(from.x)}" y1="${round(from.y)}" x2="${round(to.x)}" y2="${round(to.y)}"></line>`;
      })
      .join('');

    const nodeSvg = nodes
      .map(node => {
        const position = positions.get(node.id);
        if (!position) return '';
        const info = labelInfo(node);
        return `<g class="explore-node" role="button" tabindex="0" data-action="open" data-id="${escapeHtml(node.id)}" aria-label="Abrir ficha de ${escapeHtml(info.text)}">
          <title>${escapeHtml(`${info.text} — ${kindLabel(node.kind)}`)}</title>
          <circle class="explore-hit" cx="${round(position.x)}" cy="${round(position.y)}" r="24" aria-hidden="true"></circle>
          <circle cx="${round(position.x)}" cy="${round(position.y)}" r="8"></circle>
          <text x="${round(position.x)}" y="${round(position.y + 17)}" text-anchor="middle">${escapeHtml(truncate(info.text, 18))}</text>
        </g>`;
      })
      .join('');

    const legend = presentTypes.length
      ? `<div class="explore-legend" aria-label="Legenda de tipos de relação">
          <span class="explore-legend-title">Relações:</span>
          ${presentTypes
            .map(
              type =>
                `<span class="explore-legend-item"><svg width="30" height="8" aria-hidden="true"><line class="explore-edge ${relationTypeClass(type)}" x1="0" y1="4" x2="30" y2="4"></line></svg>${escapeHtml(REL_LABELS[type] ?? type)}</span>`,
            )
            .join('')}
        </div>`
      : '<p class="explore-muted">Nenhuma aresta documentada nesta página; os nós continuam acessíveis na lista.</p>';

    const nodeList = allNodes.length
      ? `<ul class="explore-node-list">${allNodes
          .map(node => {
            const info = labelInfo(node);
            return `<li><button type="button" class="explore-link" data-action="open" data-id="${escapeHtml(node.id)}">${escapeHtml(info.text)}</button> <span class="explore-meta">${escapeHtml(kindLabel(node.kind))}</span></li>`;
          })
          .join('')}</ul>`
      : '<p class="explore-empty">Nenhuma entidade retornada para a rede.</p>';

    const relationList = edges.length
      ? `<ul class="explore-relation-list">${edges
          .map(edge => {
            const from = labels.get(edge.from) ?? edge.from;
            const to = labels.get(edge.to) ?? edge.to;
            const evidence = arr<string>(edge.evidence).filter(item => item.trim().length > 0);
            return `<li>
              <p><button type="button" class="explore-link" data-action="open" data-id="${escapeHtml(edge.from)}">${escapeHtml(from)}</button> <span aria-hidden="true">→</span> <button type="button" class="explore-link" data-action="open" data-id="${escapeHtml(edge.to)}">${escapeHtml(to)}</button></p>
              <p class="explore-badge">${escapeHtml(REL_LABELS[edge.type] ?? edge.type)}</p>
              ${evidence.length ? `<ul class="explore-evidence-list">${evidence.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="explore-meta">Evidência não informada.</p>'}
            </li>`;
          })
          .join('')}</ul>`
      : '<p class="explore-empty">Nenhuma relação documentada nesta página.</p>';

    target.innerHTML = `<div class="explore-result-head">
        <p class="explore-result-count">${total} aresta(s) · página ${page} de ${pages} · ${nodes.length} entidade(s) na tela · ${filteredCount} resultado(s) filtrado(s)${filteredTotal > filteredCount ? ` de ${filteredTotal}` : ''}</p>
        <div class="explore-pager" role="group" aria-label="Paginação da rede">
          ${iconButton('arrow-left', 'Página anterior da rede', 'graph-prev', state.graphOffset <= 0 ? 'disabled' : '')}
          ${iconButton('arrow-right', 'Próxima página da rede', 'graph-next', state.graphOffset + GRAPH_PAGE_SIZE >= total ? 'disabled' : '')}
        </div>
      </div>
      <p class="explore-note">As linhas representam relações documentadas nesta página. Todas as entidades filtradas continuam na lista, inclusive as sem conexões.</p>
      <div class="explore-graph-wrap">
        <svg class="explore-graph" viewBox="0 0 360 260" role="group" aria-label="Rede de ${nodes.length} entidades e ${edges.length} relações desta página">
          ${edgeSvg}
          ${nodeSvg}
        </svg>
      </div>
      ${legend}
      <h3 class="explore-subtitle">Entidades da rede</h3>
      ${nodeList}
      <h3 class="explore-subtitle">Relações e evidências</h3>
      ${relationList}`;
  }

  function artSection(entity: LibraryEntity, fallbackAlt: string): string {
    const metadata = (entity.metadata ?? {}) as Record<string, unknown>;
    const fields = ['credit', 'source', 'rights', 'didacticRole'] as const;
    const fieldLabels: Record<(typeof fields)[number], string> = {
      credit: 'Crédito',
      source: 'Fonte',
      rights: 'Direitos',
      didacticRole: 'Papel didático',
    };
    const rows = fields
      .map(field => {
        const value = metadataText(metadata[field]);
        return `<div><dt>${fieldLabels[field]}</dt><dd>${value ? escapeHtml(value) : 'Não informado'}</dd></div>`;
      })
      .join('');

    const localImage = typeof metadata.localImage === 'string' ? metadata.localImage : '';
    const safePath = localImage ? safeLocalImage(localImage) : null;
    let image = '';
    if (safePath && metadata.offlineAllowed === true) {
      const alt = typeof metadata.alt === 'string' && metadata.alt.trim() ? metadata.alt.trim() : fallbackAlt;
      const full=typeof metadata.fullImage==='string'?safeLocalImage(metadata.fullImage):null;
      image = `<figure class="explore-art">
        <img src="${escapeHtml(safePath)}" alt="${escapeHtml(alt)}" loading="lazy">
        ${full?`${iconButton('preview','Ampliar imagem','art-open')}<dialog class="art-dialog" aria-label="${escapeHtml(fallbackAlt)}"><div class="art-controls">${iconButton('remove-state','Fechar imagem','art-close')}<label>Ampliação <input type="range" min="100" max="300" value="100" data-art-zoom></label></div><div class="art-viewport"><img src="${escapeHtml(full)}" alt="${escapeHtml(alt)}"></div><p>${escapeHtml(metadataText(metadata.credit))}</p></dialog>`:''}
        <figcaption>${escapeHtml(metadataText(metadata.credit) || 'Crédito não informado')}</figcaption>
      </figure>`;
    } else if (localImage) {
      image =
        '<p class="explore-muted">A imagem não está disponível para exibição neste acervo.</p>';
    } else {
      image = '<p class="explore-muted">Imagem local não informada nos metadados.</p>';
    }

    return `<section class="explore-record-section">
      <h3>Arte e direitos</h3>
      ${image}
      <dl class="explore-record-fields">${rows}</dl>
    </section>`;
  }

  function relationRecordHtml(entity: LibraryEntity, relations: LibraryRelation[]): string {
    if (!relations.length) return '<p class="explore-empty">Nenhuma relação documentada retornada.</p>';
    return `<ul class="explore-relation-list">${relations
      .map(relation => {
        const outgoing = relation.from === entity.id;
        const otherId = outgoing ? relation.to : relation.from;
        const other = labels.get(otherId) ?? otherId;
        const evidence = arr<string>(relation.evidence).filter(item => item.trim().length > 0);
        return `<li>
          <p><span class="explore-meta">${outgoing ? 'De' : 'Para'}</span> <button type="button" class="explore-link" data-action="open" data-id="${escapeHtml(otherId)}">${escapeHtml(other)}</button></p>
          <p class="explore-badge">${escapeHtml(REL_LABELS[relation.type] ?? relation.type)}</p>
          ${evidence.length ? `<ul class="explore-evidence-list">${evidence.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="explore-meta">Evidência não informada.</p>'}
        </li>`;
      })
      .join('')}</ul>`;
  }

  function recordHtml(data: unknown): string {
    const payload = data as { entity?: LibraryEntity; relations?: unknown } | null;
    const entity = payload?.entity;
    if (!entity || typeof entity.id !== 'string') {
      return '<section class="explore-record"><p class="explore-error" role="alert">Ficha sem entidade.</p></section>';
    }
    remember(entity);
    const info = labelInfo(entity);
    const allLabels = Object.entries(entity.labels ?? {})
      .map(([language, value]) => `${language}: ${value}`)
      .join(' · ');
    const aliases = arr<string>(entity.aliases);
    const relations = arr<LibraryRelation>(payload?.relations);
    const locations = arr<LibraryEntity['locations'][number]>(entity.locations);
    const fields: string[] = [];
    fields.push(
      `<div><dt>Tipo</dt><dd>${escapeHtml(kindLabel(entity.kind))}</dd></div>`,
      `<div><dt>Rótulos</dt><dd>${escapeHtml(allLabels || 'Não informados')}</dd></div>`,
    );
    if (aliases.length) {
      fields.push(`<div><dt>Aliases</dt><dd>${escapeHtml(aliases.join(', '))}</dd></div>`);
    }
    if (['work', 'art', 'edition'].includes(entity.kind) || entity.authorship) {
      fields.push(`<div><dt>Autoria</dt><dd>${escapeHtml(authorshipText(entity))}</dd></div>`);
    }
    fields.push(
      `<div><dt>Datas</dt><dd>${escapeHtml(formatDates(entity.dates))}${entity.dates?.evidence ? ` · evidência: ${escapeHtml(entity.dates.evidence)}` : ''}</dd></div>`,
    );
    const dimensions: { label: string; values: string }[] = [
      { label: 'Regiões', values: joinIds(entity.regions) },
      { label: 'Tradições', values: joinIds(entity.traditions) },
      { label: 'Disciplinas', values: joinIds(entity.disciplines) },
      { label: 'Períodos', values: joinIds(entity.periods) },
    ];
    for (const dimension of dimensions) {
      if (dimension.values) {
        fields.push(
          `<div><dt>${dimension.label}</dt><dd>${escapeHtml(dimension.values)}</dd></div>`,
        );
      }
    }

    const locationHtml = locations.length
      ? `<ul class="explore-location-list">${locations
          .map(location => {
            const role = ROLES.includes(location.role) ? location.role : 'activity';
            return `<li class="explore-location">
              <p><span class="explore-badge">${escapeHtml(roleLabel(role))}</span> ${escapeHtml(`${location.lat}, ${location.lon}`)}</p>
              <p class="explore-evidence">Evidência: ${escapeHtml(location.evidence)}</p>
              <p class="explore-meta">Datas: ${escapeHtml(location.dates ?? 'não informadas')}${entity.dates?.approximate ? ' · datação da entidade aproximada' : ''}</p>
            </li>`;
          })
          .join('')}</ul>`
      : '<p class="explore-empty">Nenhum local documentado no registro.</p>';

    return `<section class="explore-record" aria-labelledby="explore-record-title">
      <div class="explore-record-head">
        <h2 id="explore-record-title" tabindex="-1">${escapeHtml(info.text)}</h2>
        ${iconButton('arrow-left', 'Fechar ficha', 'close-record')}
      </div>
      <span class="explore-badge">${escapeHtml(kindLabel(entity.kind))}</span>
      <dl class="explore-record-fields">${fields.join('')}</dl>
      ${entity.kind === 'art' ? artSection(entity, info.text) : ''}
      <section class="explore-record-section">
        <h3>Locais documentados</h3>
        ${locationHtml}
      </section>
      <section class="explore-record-section">
        <h3>Relações e evidências</h3>
        ${relationRecordHtml(entity, relations)}
      </section>
    </section>`;
  }

  function clearRecord(): void {
    recordSeq += 1;
    recordController?.abort();
    recordController = null;
    const slot = recordSlot();
    if (slot) slot.innerHTML = '';
    lastRecordTrigger = null;
  }

  async function openRecord(id: string, trigger: Element | null): Promise<void> {
    if (!id) return;
    lastRecordTrigger = trigger;
    const token = ++recordSeq;
    recordController?.abort();
    const controller = new AbortController();
    recordController = controller;
    const slot = recordSlot();
    if (!slot) return;
    slot.innerHTML = '<p class="explore-muted" role="status">Carregando ficha…</p>';
    try {
      const data = await abortable(api('library_get', { entityId: id }), controller.signal);
      if (token !== recordSeq || controller.signal.aborted) return;
      slot.innerHTML = recordHtml(data);
      const title = slot.querySelector<HTMLElement>('#explore-record-title');
      if (title) title.focus();
    } catch (error) {
      if (isAbort(error) || token !== recordSeq) return;
      slot.innerHTML = `<section class="explore-record"><p class="explore-error" role="alert">Não foi possível abrir a ficha: ${escapeHtml(messageOf(error))}</p></section>`;
    }
  }

  function buildFilters(offset: number, limit: number): Record<string, unknown> {
    const filters: Record<string, unknown> = { offset, limit };
    const query = state.query.trim();
    if (query) filters.query = query;
    if (state.kinds.length) filters.kinds = [...state.kinds];
    if (state.regions.length) filters.regions = [...state.regions];
    if (state.periods.length) filters.periods = [...state.periods];
    if (state.traditions.length) filters.traditions = [...state.traditions];
    if (state.disciplines.length) filters.disciplines = [...state.disciplines];
    if (state.authorIds.length) filters.authorIds = [...state.authorIds];
    const from = parseYear(state.fromYear);
    const to = parseYear(state.toYear);
    if (from !== null) filters.fromYear = from;
    if (to !== null) filters.toYear = to;
    return filters;
  }

  function parseYear(value: string): number | null {
    const trimmed = value.trim();
    if (!/^-?\d{1,6}$/.test(trimmed)) return null;
    const numeric = Number(trimmed);
    return Number.isInteger(numeric) ? numeric : null;
  }

  async function refresh(): Promise<void> {
    if(searchTimer!==null){window.clearTimeout(searchTimer);searchTimer=null;}
    const token = ++seq;
    apiController?.abort();
    const controller = new AbortController();
    apiController = controller;
    const target = content();
    if (!target) return;
    setStatus('Carregando…');
    target.innerHTML = '<p class="explore-muted" role="status">Carregando…</p>';
    try {
      if (state.mode === 'list') {
        const data = await abortable<PageData>(
          api('library_search', buildFilters(state.offset, PAGE_SIZE)),
          controller.signal,
        );
        if (token !== seq) return;
        renderList(data);
        setStatus(`${numOr0(data.total)} resultado(s).`);
      } else if (state.mode === 'map') {
        const data = await abortable<MapData>(
          api('library_map', buildFilters(state.offset, PAGE_SIZE)),
          controller.signal,
        );
        if (token !== seq) return;
        renderMap(data);
        setStatus(
          `${numOr0(data.total)} resultado(s); ${arr(data.locations).length} local(is) documentado(s) nesta página.`,
        );
        void ensureLand();
      } else {
        const search = await abortable<PageData>(
          api('library_search', buildFilters(0, GRAPH_ID_LIMIT)),
          controller.signal,
        );
        if (token !== seq) return;
        const items = arr<LibraryEntity>(search.items);
        rememberAll(items);
        const ids = items.map(item => item.id);
        if (!ids.length) {
          target.innerHTML =
            '<p class="explore-empty">Nenhum resultado filtrado para montar a rede.</p>';
          setStatus('Nenhuma entidade filtrada.');
          return;
        }
        const data = await abortable<GraphData>(
          api('library_graph', {
            entityIds: ids,
            offset: state.graphOffset,
            limit: GRAPH_PAGE_SIZE,
          }),
          controller.signal,
        );
        if (token !== seq) return;
        renderGraph(data, ids.length, numOr0(search.total));
        setStatus(`${numOr0(data.total)} aresta(s) documentada(s); ${arr(data.edges).length} nesta página.`);
      }
    } catch (error) {
      if (isAbort(error) || token !== seq) return;
      target.innerHTML = `<p class="explore-empty explore-error" role="alert">Não foi possível carregar: ${escapeHtml(messageOf(error))}</p>`;
      setStatus('Falha ao carregar.');
    }
  }

  function applyMapTransform(): void {
    const layer = section.querySelector('[data-map-layer]');
    if (!layer) return;
    const translateX = 180 - 180 * mapZoom + mapPanX;
    const translateY = 90 - 90 * mapZoom + mapPanY;
    layer.setAttribute(
      'transform',
      `translate(${round(translateX)} ${round(translateY)}) scale(${round(mapZoom)})`,
    );
  }

  function clampPan(): void {
    const limitX = 180 * mapZoom;
    const limitY = 90 * mapZoom;
    mapPanX = Math.max(-limitX, Math.min(limitX, mapPanX));
    mapPanY = Math.max(-limitY, Math.min(limitY, mapPanY));
  }

  function zoomBy(factor: number): void {
    mapZoom = Math.max(1, Math.min(8, mapZoom * factor));
    clampPan();
    applyMapTransform();
    setStatus(`Mapa em ${round(mapZoom)}×.`);
  }

  function panBy(x: number, y: number): void {
    mapPanX += x;
    mapPanY += y;
    clampPan();
    applyMapTransform();
  }

  function resetMap(): void {
    mapZoom = 1;
    mapPanX = 0;
    mapPanY = 0;
    applyMapTransform();
    setStatus('Mapa recentralizado.');
  }

  function ensureLand(): void {
    if (landPaths || landLoading) return;
    const controller = new AbortController();
    mapController?.abort();
    mapController = controller;
    landLoading = (async () => {
      try {
        const response = await fetch(new URL('map/land.geojson', document.baseURI), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const geo: unknown = await response.json();
        if (controller.signal.aborted) return;
        const paths = geojsonPaths(geo);
        if (!paths.length) throw new Error('nenhum polígono de terra reconhecível');
        landPaths = paths;
        landError = '';
      } catch (error) {
        if (isAbort(error)) return;
        landError = messageOf(error);
      } finally {
        landLoading = null;
      }
      if (!controller.signal.aborted && state.mode === 'map' && lastMapData) {
        renderMap(lastMapData);
      }
    })();
  }

  function checkboxHtml(dim: FilterDim, value: string, title: string): string {
    const selected = state[dim].includes(value);
    return `<label class="explore-check"><input type="checkbox" data-filter-dim="${dim}" value="${escapeHtml(value)}"${selected ? ' checked' : ''}><span>${escapeHtml(title)}</span></label>`;
  }

  function renderFilters(): void {
    const target = section.querySelector<HTMLElement>('[data-filters]');
    if (!target) return;
    const blocks: string[] = [];
    blocks.push(`<fieldset class="explore-fieldset">
      <legend>Tipo</legend>
      <div class="explore-checks">${KIND_OPTIONS.map(kind => checkboxHtml('kinds', kind, kindLabel(kind))).join('')}</div>
    </fieldset>`);

    for (const facet of FACET_DIMS) {
      const entities = facets[facet.dim]
        .slice()
        .sort((a, b) => labelInfo(a).text.localeCompare(labelInfo(b).text, 'pt'));
      if (!entities.length) continue;
      entities.forEach(entity => remember(entity));
      blocks.push(`<fieldset class="explore-fieldset">
        <legend>${facet.title}</legend>
        <div class="explore-checks">${entities.map(entity => checkboxHtml(facet.dim, entity.id, labelInfo(entity).text)).join('')}</div>
      </fieldset>`);
    }

    blocks.push(`<fieldset class="explore-fieldset">
      <legend>Intervalo de ano</legend>
      <div class="explore-years">
        <label>De <input type="number" inputmode="numeric" step="1" data-year="from" value="${escapeHtml(state.fromYear)}" aria-label="Ano inicial"></label>
        <label>Até <input type="number" inputmode="numeric" step="1" data-year="to" value="${escapeHtml(state.toYear)}" aria-label="Ano final"></label>
      </div>
      <p class="explore-hint">Use anos negativos para a.C. Ex.: -500.</p>
    </fieldset>`);

    if (facetsError) {
      blocks.push(
        `<p class="explore-error" role="alert">Categorias indisponíveis: ${escapeHtml(facetsError)}</p>`,
      );
    }

    blocks.push(
      `<div class="explore-filter-actions">${iconButton('reset','Limpar filtros','clear-filters')}</div>`,
    );
    target.innerHTML = blocks.join('');
    updateFilterCount();
  }

  function updateFilterCount(): void {
    const active = FILTER_DIMS.filter(dim => state[dim].length > 0).length +
      (state.fromYear.trim() || state.toYear.trim() ? 1 : 0);
    const counter = section.querySelector<HTMLElement>('[data-filter-count]');
    if (counter) counter.textContent = `${active} ativo${active === 1 ? '' : 's'}`;
  }

  function updateModeButtons(): void {
    section.querySelectorAll<HTMLElement>('[data-action="mode"]').forEach(button => {
      const active = button.dataset.mode === state.mode;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    });
  }

  function setMode(mode: Mode): void {
    if (state.mode === mode) return;
    state.mode = mode;
    state.offset = 0;
    state.graphOffset = 0;
    updateModeButtons();
    if (mode !== 'map') {
      mapController?.abort();
      mapController = null;
    }
    void refresh();
  }

  function clearFilters(): void {
    state.query = '';
    for (const dim of FILTER_DIMS) state[dim] = [];
    state.fromYear = '';
    state.toYear = '';
    state.offset = 0;
    state.graphOffset = 0;
    const search = section.querySelector<HTMLInputElement>('[data-search]');
    if (search) search.value = '';
    section.querySelectorAll<HTMLInputElement>('[data-filter-dim]').forEach(input => {
      input.checked = false;
    });
    section.querySelectorAll<HTMLInputElement>('[data-year]').forEach(input => {
      input.value = '';
      input.removeAttribute('aria-invalid');
    });
    updateFilterCount();
    void refresh();
  }

  function closeRecord(): void {
    const trigger = lastRecordTrigger;
    clearRecord();
    if (trigger && trigger.isConnected) {
      (trigger as Element & { focus?: () => void }).focus?.();
    }
  }

  function scheduleSearch(): void {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      state.offset = 0;
      state.graphOffset = 0;
      void refresh();
    }, 280);
  }

  function onClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const actionElement = target?.closest('[data-action]') as
      | (Element & { dataset: DOMStringMap })
      | null;
    if (!actionElement) return;
    const action = actionElement.dataset.action;
    if (!action) return;
    if(action==='art-open'){section.querySelector<HTMLDialogElement>('.art-dialog')?.showModal();return;}
    if(action==='art-close'){section.querySelector<HTMLDialogElement>('.art-dialog')?.close();return;}

    if (action === 'mode') {
      const mode = actionElement.dataset.mode;
      if (mode === 'list' || mode === 'map' || mode === 'graph') setMode(mode);
    } else if (action === 'open') {
      const id = actionElement.dataset.id;
      if (id) void openRecord(id, actionElement);
    } else if (action === 'close-record') {
      closeRecord();
    } else if (action === 'page-prev') {
      state.offset = Math.max(0, state.offset - PAGE_SIZE);
      void refresh();
    } else if (action === 'page-next') {
      state.offset += PAGE_SIZE;
      void refresh();
    } else if (action === 'graph-prev') {
      state.graphOffset = Math.max(0, state.graphOffset - GRAPH_PAGE_SIZE);
      void refresh();
    } else if (action === 'graph-next') {
      state.graphOffset += GRAPH_PAGE_SIZE;
      void refresh();
    } else if (action === 'map-zoom-in') {
      zoomBy(1.5);
    } else if (action === 'map-zoom-out') {
      zoomBy(1 / 1.5);
    } else if (action === 'map-reset') {
      resetMap();
    } else if (action === 'map-pan-left') {
      panBy(-30, 0);
    } else if (action === 'map-pan-right') {
      panBy(30, 0);
    } else if (action === 'map-pan-up') {
      panBy(0, -20);
    } else if (action === 'map-pan-down') {
      panBy(0, 20);
    } else if (action === 'clear-filters') {
      clearFilters();
    }
  }

  function onChange(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const dim = input.dataset.filterDim as FilterDim | undefined;
    if (dim && FILTER_DIMS.includes(dim)) {
      const values = state[dim];
      if (input.checked) {
        if (!values.includes(input.value)) values.push(input.value);
      } else {
        const index = values.indexOf(input.value);
        if (index >= 0) values.splice(index, 1);
      }
      state.offset = 0;
      state.graphOffset = 0;
      updateFilterCount();
      void refresh();
      return;
    }

    const year = input.dataset.year;
    if (year === 'from' || year === 'to') {
      const value = input.value.trim();
      if (value && !/^-?\d{1,6}$/.test(value)) {
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      input.removeAttribute('aria-invalid');
      const nextFrom = year === 'from' ? value : state.fromYear;
      const nextTo = year === 'to' ? value : state.toYear;
      const from = parseYear(nextFrom);
      const to = parseYear(nextTo);
      if (from !== null && to !== null && from > to) {
        setStatus('Intervalo inválido: o ano inicial não pode ser maior que o final.');
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      state.fromYear = nextFrom;
      state.toYear = nextTo;
      state.offset = 0;
      state.graphOffset = 0;
      updateFilterCount();
      void refresh();
    }
  }

  function onInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if(input.hasAttribute('data-art-zoom')){const img=section.querySelector<HTMLImageElement>('.art-viewport img');if(img)img.style.width=input.value+'%';return;}
    if (!input.matches('[data-search]')) return;
    state.query = input.value;
    scheduleSearch();
  }

  function onKeyDown(event: KeyboardEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const svg = target.closest('svg[data-map]');
    if (svg) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        panBy(-30, 0);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        panBy(30, 0);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        panBy(0, -20);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        panBy(0, 20);
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomBy(1.5);
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomBy(1 / 1.5);
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        resetMap();
        return;
      }
    }

    if (event.key !== 'Enter' && event.key !== ' ') return;
    const actionElement = target.closest('[data-action="open"]');
    if (!actionElement || actionElement instanceof HTMLButtonElement) return;
    if (actionElement.tagName.toLowerCase() === 'g') {
      event.preventDefault();
      actionElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  }

  async function loadFacets(): Promise<void> {
    facetController?.abort();
    const controller = new AbortController();
    facetController = controller;

    const fetchFacet = async (kind: string): Promise<LibraryEntity[]> => {
      const output: LibraryEntity[] = [];
      let offset = 0;
      for (let pageIndex = 0; pageIndex < 6; pageIndex += 1) {
        const page = await abortable<PageData>(
          api('library_search', { kinds: [kind], offset, limit: 100 }),
          controller.signal,
        );
        const items = arr<LibraryEntity>(page.items);
        output.push(...items);
        const total = numOr0(page.total);
        offset += items.length;
        if (!items.length || offset >= total) break;
      }
      output.forEach(item => remember(item));
      return output;
    };

    try {
      const [regions, periods, traditions, disciplines, authors] = await Promise.all([
        fetchFacet('place'),
        fetchFacet('period'),
        fetchFacet('tradition'),
        fetchFacet('discipline'),
        fetchFacet('author'),
      ]);
      if (controller.signal.aborted) return;
      facets = { regions, periods, traditions, disciplines, authorIds: authors };
      facetsError = '';
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) return;
      facetsError = messageOf(error);
    }
    if (!controller.signal.aborted) renderFilters();
  }

  section.addEventListener('click', onClick);
  section.addEventListener('change', onChange);
  section.addEventListener('input', onInput);
  section.addEventListener('keydown', onKeyDown);

  void loadFacets();
  void refresh();

  return () => {
    seq += 1;
    recordSeq += 1;
    if (searchTimer !== null) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }
    apiController?.abort();
    recordController?.abort();
    facetController?.abort();
    mapController?.abort();
    apiController = null;
    recordController = null;
    facetController = null;
    mapController = null;
    section.removeEventListener('click', onClick);
    section.removeEventListener('change', onChange);
    section.removeEventListener('input', onInput);
    section.removeEventListener('keydown', onKeyDown);
    section.remove();
  };
}
