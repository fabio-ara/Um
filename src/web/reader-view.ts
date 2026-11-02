import './reader-view.css';
import { escapeHtml, iconButton, renderBody, announce, type StudyApi } from './dom.ts';
import { utf16ToCodePoint, selectionMatches } from '../anchors.ts';
import type { Anchor, Choice, DocumentLink, ReaderTab, Resource, StudyUnit } from '../contracts.ts';

type Options = { projectId: string; profileId: string; api: StudyApi; onExit: () => void };
type IndexEntry = { id: string; kind: 'unit' | 'resource' | 'choice' | 'coverage'; title: string; file: string; unitId?: string; position?: number };
type SourceIndexEntry = { id: string; revision: number; title: string; path: string; original: string | null };
type Manifest = {
  projectId: string; revision: number; profileId: string | null; baseRevision: number; index: IndexEntry[];
  sourceIndex: SourceIndexEntry[]; inspection: { kind: 'ai'; references: string[]; findings: string[]; completed: boolean };
};
type SourceBlock = { id: string; kind: string; text: string; locator?: string };
type SourcePage = { id: string; revision: number; title: string; language: string; nature: string; blocks: SourceBlock[]; total: number; offset: number; limit: number; complete: boolean };
type RecordItem = { id: string; revision: number; data: any };
type PassageGroup = { key: string; anchor: Anchor; relations: Set<DocumentLink['relation']>; provenance: any[] };
type SelMatch = { id: string; target: Anchor; match: 'exact' | 'contains' };
type Practice = {
  unitId: string; sequenceId: string; questions: Choice[]; index: number; bundleRevision: number;
  errorsOnly: boolean; feedback: { optionId: string; correct: boolean; feedback: string } | null; error: string | null; finished: boolean;
};

type WriteOutcome = { state: 'confirmed'; result: any } | { state: 'pending'; result:any } | { state: 'unknown'; value: any };

function outcomeOf(value: any): WriteOutcome {
  if (value && typeof value === 'object' && typeof value.status === 'string' && 'result' in value) {
    if (value.status === 'confirmed') return { state: 'confirmed', result: value.result };
    if (['pending','local','uncertain'].includes(value.status)) return { state: 'pending',result:value.result };
  }
  return { state: 'unknown', value };
}

const SOURCE_LIMIT = 40;
const FULL_LIMIT = 100;
const uid = (): string => crypto.randomUUID();
const h = (v: unknown) => escapeHtml(v);

function messageOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown };
    if (typeof e.message === 'string' && e.message.trim()) return e.message;
    if (typeof e.code === 'string' && e.code.trim()) return e.code;
  }
  return 'Falha inesperada.';
}

function statusOf(error: unknown): number {
  if (error && typeof error === 'object') {
    const e = error as { status?: unknown; statusCode?: unknown };
    if (typeof e.status === 'number') return e.status;
    if (typeof e.statusCode === 'number') return e.statusCode;
  }
  return 0;
}

function dataOf(item: RecordItem): any {
  if (!item || item.data == null) return null;
  if (typeof item.data === 'string') {
    try { return JSON.parse(item.data); } catch { return null; }
  }
  return item.data;
}

function targetOf(value: any): Anchor | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Anchor; } catch { return null; }
  }
  return typeof value === 'object' ? value as Anchor : null;
}

const RELATION: Record<string, string> = { supports: 'Fundamenta', interprets: 'Interpreta', contrasts: 'Contrasta', illustrates: 'Ilustra' };
const NATURE: Record<string, string> = { original: 'Original', translation: 'Tradução', commentary: 'Comentário', bibliography: 'Bibliografia' };
const PROVENANCE: Record<string, string> = { source: 'Fonte', translation: 'Tradução', interpretation: 'Interpretação', controversy: 'Controvérsia', example: 'Exemplo', reflection: 'Reflexão' };
const RESOURCE_TYPE: Record<string, string> = { explanation: 'Explicação', analogy: 'Analogia', context: 'Contexto', contrast: 'Contraste', interpretation: 'Interpretação', reflection: 'Reflexão', vocabulary: 'Vocabulário' };

export async function mountReader(root: HTMLElement, options: Options): Promise<() => void> {
  const { projectId, profileId, api, onExit } = options;
  let active = true;
  let booted = false;
  let fatalError = '';
  let commonManifest: Manifest | null = null;
  let personalManifest: Manifest | null = null;
  let units: IndexEntry[] = [];
  let sourceIndex: SourceIndexEntry[] = [];
  let personalError = '';
  let personalStale = false;

  let tabs: ReaderTab[] = [];
  let activeTabId = '';
  let currentUnitId = '';
  let stateRecordId: string = uid();
  let stateRevision = 0;
  let saveStatus = '';
  let lastTabRendered = '';

  let contentCache = new Map<string, any>();
  let contentPromises = new Map<string, Promise<any>>();
  let contentErrors = new Map<string, string>();
  let resources: Resource[] = [];
  let resourcesLoaded = false;
  let resourcesLoading = false;

  let sourcePages = new Map<string, SourcePage>();
  let sourcePromises = new Map<string, Promise<SourcePage>>();
  let sourceErrors = new Map<string, string>();
  let sourceMetaCache = new Map<string, { title: string; language: string; nature: string }>();
  let sourceOffsets = new Map<string, number>();

  let notes: RecordItem[] = [];
  let terms: RecordItem[] = [];
  let comments: any[] = [];
  let observations: any[] = [];
  let recordErrors = new Map<string, string>();

  let sectionOpen = new Set<string>(['resources']);
  let openForm: string | null = null;
  let selAnchor: Anchor | null = null;
  let selMatches: SelMatch[] = [];
  let replyTo: string | null = null;
  let sharedNotes = new Set<string>();

  let practice: Practice | null = null;
  let practiceLoading = false;
  let practiceOps = new Map<string, string>();
  const practiceDates = new Map<string,string>();

  let originLinks = new Map<string, string>();
  let contextOpen = new Set<string>();
  let uiAnchors = new Map<string, Anchor>();
  let pendingFocus: string | null = null;
  let forceScrollTop = false;

  let clockTimer: number | null = null;
  let lastTick = Date.now();
  let lastSent = 0;
  let accrued = 0;
  let visible = document.visibilityState === 'visible';
  let focused = document.hasFocus();

  let saveTimer: number | null = null;
  let selectionTimer: number | null = null;
  let saving = false;
  let queuedSave = false;

  const controller = new AbortController();
  const signal = controller.signal;
  const rootEl = root;

  const index = () => (commonManifest ? [...commonManifest.index] : []).concat(personalManifest && !personalStale ? [...personalManifest.index] : []);
  const entryOf = (id: string) => index().find(e => e.id === id);
  const sourceEntry = (id: string, rev: number) => sourceIndex.find(s => s.id === id && s.revision === rev);
  const activeTab = () => tabs.find(t => t.id === activeTabId) || null;
  const unitEntry = (id: string) => units.find(u => u.id === id) || null;
  const unitTitle = (id: string) => unitEntry(id)?.title || 'Unidade';

  function manifestFor(id: string): { manifest: Manifest; profile: string | null } | null {
    if (personalManifest && !personalStale && personalManifest.index.some(e => e.id === id)) return { manifest: personalManifest, profile: profileId };
    if (commonManifest && commonManifest.index.some(e => e.id === id)) return { manifest: commonManifest, profile: null };
    return null;
  }

  function revisionFor(id: string): number {
    return manifestFor(id)?.manifest.revision || commonManifest?.revision || 1;
  }

  function anchorRef(anchor: Anchor): string {
    const key = uid();
    uiAnchors.set(key, anchor);
    return key;
  }

  function groupsFor(unit: StudyUnit): PassageGroup[] {
    const map = new Map<string, PassageGroup>();
    for (const link of unit.references || []) {
      for (const anchor of [...(link.from || []), ...(link.to || [])]) {
        const key = [anchor.sourceId, anchor.sourceRevision, anchor.elementId, anchor.start, anchor.end, anchor.exact].join('|');
        let group = map.get(key);
        if (!group) {
          group = { key, anchor, relations: new Set(), provenance: [] };
          map.set(key, group);
        }
        group.relations.add(link.relation);
        group.provenance.push(link.provenance);
      }
    }
    return [...map.values()];
  }

  function metaFor(id: string, rev: number) {
    const cached = sourceMetaCache.get(`${id}:${rev}`);
    const indexed = sourceEntry(id, rev);
    return {
      title: cached?.title || indexed?.title || 'Fonte',
      language: cached?.language || '',
      nature: cached?.nature || '',
    };
  }

  const pageKey = (id: string, rev: number, offset: number, limit: number) => `${id}:${rev}:${offset}:${limit}`;

  function normalizeSource(raw: any, id: string, rev: number, offset: number, limit: number): SourcePage {
    const metadata = raw?.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
    const blocks: SourceBlock[] = Array.isArray(raw?.blocks) ? raw.blocks : [];
    const title = String(metadata.title ?? '');
    const language = String(metadata.language ?? '');
    const nature = String(metadata.nature ?? '');
    if (title || language || nature) sourceMetaCache.set(`${id}:${rev}`, { title: title || metaFor(id, rev).title, language, nature });
    return {
      id, revision: rev, title, language, nature, blocks,
      total: typeof raw?.total === 'number' ? raw.total : blocks.length,
      offset: typeof raw?.offset === 'number' ? raw.offset : offset,
      limit,
      complete: raw?.complete === true,
    };
  }

  function hasNext(page: SourcePage): boolean {
    return page.offset + page.blocks.length < page.total;
  }

  function nextOffset(page: SourcePage): number {
    return page.offset + page.blocks.length;
  }

  function sourcePage(id: string, rev: number, offset: number, limit: number): Promise<SourcePage> {
    const key = pageKey(id, rev, offset, limit);
    const cached = sourcePages.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = sourcePromises.get(key);
    if (pending) return pending;
    const promise = api('source_get', { sourceId: id, sourceRevision: rev, offset, limit })
      .then((raw: any) => {
        const page = normalizeSource(raw, id, rev, offset, limit);
        sourcePages.set(key, page);
        return page;
      })
      .finally(() => { sourcePromises.delete(key); });
    sourcePromises.set(key, promise);
    return promise;
  }

  function ensureSourcePage(id: string, rev: number, offset: number, limit: number): void {
    const key = pageKey(id, rev, offset, limit);
    if (sourcePages.has(key) || sourcePromises.has(key) || sourceErrors.has(key)) return;
    void sourcePage(id, rev, offset, limit)
      .then(() => { if (active) render(); })
      .catch(error => { sourceErrors.set(key, messageOf(error)); if (active) render(); });
  }

  function contentFor(id: string): Promise<any> {
    if (contentCache.has(id)) return Promise.resolve(contentCache.get(id));
    const pending = contentPromises.get(id);
    if (pending) return pending;
    const owner = manifestFor(id);
    const promise = api('content_get', {
      projectId,
      profileId: owner ? owner.profile : null,
      revision: owner ? owner.manifest.revision : commonManifest?.revision,
      contentId: id,
    }).then((data: any) => { contentCache.set(id, data); return data; })
      .finally(() => { contentPromises.delete(id); });
    contentPromises.set(id, promise);
    return promise;
  }

  function ensureContent(id: string): void {
    if (contentCache.has(id) || contentPromises.has(id) || contentErrors.has(id)) return;
    void contentFor(id).then(() => { if (active) render(); })
      .catch(error => { contentErrors.set(id, messageOf(error)); if (active) render(); });
  }

  async function loadAllResources(): Promise<void> {
    if (resourcesLoaded || resourcesLoading) return;
    resourcesLoading = true;
    const entries = index().filter(e => e.kind === 'resource');
    const loaded = await Promise.all(entries.map(async entry => {
      try { return await contentFor(entry.id) as Resource; }
      catch (error) { contentErrors.set(entry.id, messageOf(error)); return null; }
    }));
    resources = loaded.filter((r): r is Resource => Boolean(r));
    resourcesLoaded = true;
    resourcesLoading = false;
    if (active) render();
  }

  async function loadRecords(kind: 'note' | 'term'): Promise<RecordItem[]> {
    try {
      const result = await api('reader_records', { projectId, profileId, kind, offset: 0, limit: 100 });
      return Array.isArray(result?.items) ? result.items : [];
    } catch (error) {
      recordErrors.set(kind, messageOf(error));
      return [];
    }
  }

  async function loadComments(): Promise<void> {
    try { comments = (await api('comment_list', { projectId, offset: 0, limit: 100 }))?.items || []; }
    catch (error) { recordErrors.set('comments', messageOf(error)); }
  }

  async function loadObservations(): Promise<void> {
    try { observations = (await api('observation_list', { projectId, offset: 0, limit: 100 }))?.items || []; }
    catch (error) { recordErrors.set('observations', messageOf(error)); }
  }

  async function loadState(): Promise<{ id: string; revision: number; data: any } | null> {
    try {
      const result = await api('reader_records', { projectId, profileId, kind: 'state', offset: 0, limit: 10 });
      const items: RecordItem[] = Array.isArray(result?.items) ? result.items : [];
      const best = [...items].sort((a, b) => (b.revision || 0) - (a.revision || 0))[0];
      if (!best) return null;
      return { id: best.id, revision: best.revision || 0, data: dataOf(best) };
    } catch (error) {
      recordErrors.set('state', messageOf(error));
      return null;
    }
  }

  function validTabs(value: any): ReaderTab[] {
    if (!Array.isArray(value)) return [];
    return value.filter((tab: any) => tab && typeof tab.id === 'string' && typeof tab.objectId === 'string'
      && ['unit', 'resource', 'sources', 'source'].includes(tab.kind) && typeof tab.title === 'string' && tab.title.length > 0)
      .slice(0, 40)
      .map((tab: any) => ({
        id: String(tab.id), kind: tab.kind, title: String(tab.title), objectId: String(tab.objectId),
        revision: Math.max(1, Number(tab.revision) || 1), position: Math.max(0, Number(tab.position) || 0),
        origin: targetOf(tab.origin), anchor: targetOf(tab.anchor),
        ...(tab.anchorStatus === 'needs_review' || tab.anchorStatus === 'verified' ? { anchorStatus: tab.anchorStatus } : {}),
      } as ReaderTab));
  }

  function makeUnitTab(unitId: string): ReaderTab {
    return {
      id: uid(), kind: 'unit', title: unitTitle(unitId), objectId: unitId,
      revision: revisionFor(unitId), position: 0, origin: null, anchor: null,
    };
  }

  async function boot(): Promise<void> {
    const results = await Promise.all([
      api('bundle_get', { projectId, profileId: null }),
      api('bundle_get', { projectId, profileId }).catch((error: unknown) => { personalError = messageOf(error); return null; }),
    ]);
    commonManifest = results[0] as Manifest;
    personalManifest = results[1] as Manifest | null;
    if (!commonManifest || !Array.isArray(commonManifest.index)) throw new Error('Conteúdo comum indisponível.');
    if (personalManifest && Number(personalManifest.baseRevision) !== Number(commonManifest.revision)) {
      personalStale = true;
      personalError = `Complemento pessoal na base ${h(personalManifest.baseRevision)}, diferente da base comum ${h(commonManifest.revision)}. Recursos e práticas pessoais não serão aplicados; o conteúdo comum permanece legível.`;
    }
    units = commonManifest.index.filter(e => e.kind === 'unit');
    sourceIndex = [...(commonManifest.sourceIndex || [])];
    if (!personalStale) {
      for (const entry of (personalManifest?.sourceIndex || [])) {
        if (!sourceIndex.some(s => s.id === entry.id && s.revision === entry.revision)) sourceIndex.push(entry);
      }
    }
    if (!units.length) throw new Error('O pacote não contém unidade de estudo.');

    const restored = await loadState();
    if (restored) {
      stateRecordId = restored.id;
      stateRevision = restored.revision;
      const data = restored.data;
      const restoredTabs = validTabs(data?.tabs);
      if (restoredTabs.length) {
        tabs = restoredTabs;
        activeTabId = restoredTabs.some(t => t.id === data?.activeTabId) ? data.activeTabId : restoredTabs[0].id;
      }
      if (typeof data?.unitId === 'string' && units.some(u => u.id === data.unitId)) currentUnitId = data.unitId;
    }
    if (!units.some(u => u.id === currentUnitId)) {
      const activeUnit = tabs.find(t => t.kind === 'unit');
      currentUnitId = activeUnit ? activeUnit.objectId : units[0].id;
    }
    if (!units.some(u => u.id === currentUnitId)) currentUnitId = units[0].id;

    const foundUnitTab = tabs.find(t => t.kind === 'unit');
    let unitTabId: string;
    if (!foundUnitTab) {
      const created = makeUnitTab(currentUnitId);
      tabs.unshift(created);
      unitTabId = created.id;
    } else {
      if (!units.some(u => u.id === foundUnitTab.objectId)) {
        foundUnitTab.objectId = currentUnitId;
        foundUnitTab.title = unitTitle(currentUnitId);
        foundUnitTab.revision = revisionFor(currentUnitId);
      }
      unitTabId = foundUnitTab.id;
    }
    if (!tabs.some(t => t.id === activeTabId)) activeTabId = unitTabId;

    const [loadedNotes, loadedTerms] = await Promise.all([loadRecords('note'), loadRecords('term'), loadComments(), loadObservations()]);
    notes = loadedNotes;
    terms = loadedTerms;
    booted = true;
    void loadAllResources();
    startClock();
  }

  function startClock(): void {
    lastTick = Date.now();
    clockTimer = window.setInterval(() => {
      if (!active) return;
      const now = Date.now();
      const counting = visible && focused && document.hasFocus() && document.visibilityState === 'visible';
      const delta = counting && currentUnitId ? Math.min(Math.max(0, now - lastTick), 5000) : 0;
      lastTick = now;
      accrued += delta / 1000;
      if (accrued >= 60) flushTime(false);
    }, 1000);
  }

  function flushTime(force: boolean): void {
    const seconds = Math.floor(accrued);
    if (seconds < 1 || !currentUnitId) return;
    const elapsed = Date.now() - lastSent;
    if (elapsed < 60000) return;
    if (!force && seconds < 60) return;
    const send = Math.min(3600, seconds);
    accrued -= send;
    lastSent = Date.now();
    void api('time_record', { operationId: uid(), projectId, profileId, unitId: currentUnitId, seconds: send })
      .catch((error: unknown) => {
        accrued += send;
        saveStatus = `Tempo não registrado: ${messageOf(error)}`;
        if (active) render();
      });
  }

  function stateSnapshot(): any {
    const clean = tabs.slice(0, 40).map(tab => ({
      id: tab.id, kind: tab.kind, title: tab.title, objectId: tab.objectId,
      revision: Math.max(1, Number(tab.revision) || 1), position: Math.max(0, Number(tab.position) || 0),
      origin: tab.origin || null, anchor: tab.anchor || null,
      ...(tab.anchorStatus ? { anchorStatus: tab.anchorStatus } : {}),
    }));
    return {
      projectId, profileId, unitId: currentUnitId, tabs: clean,
      activeTabId: clean.some(t => t.id === activeTabId) ? activeTabId : clean[0]?.id,
      revision: Math.max(1, stateRevision + 1),
    };
  }

  function scheduleSave(): void {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { saveTimer = null; void saveNow(); }, 450);
  }

  async function saveNow(): Promise<void> {
    if (!booted || !active) return;
    if (saving) { queuedSave = true; return; }
    if (!tabs.length) return;
    saving = true;
    try {
      const outcome = outcomeOf(await api('reader_state_save', {
        operationId: uid(), projectId, profileId, recordId: stateRecordId,
        expectedRevision: stateRevision, state: stateSnapshot(),
      }));
      if (outcome.state === 'confirmed') {
        const result = outcome.result || {};
        if (result.recordId) stateRecordId = result.recordId;
        stateRevision = Number(result.revision) || stateRevision + 1;
        saveStatus = '';
      } else if (outcome.state === 'pending') {
        stateRevision = Number(outcome.result?.revision) || stateRevision + 1;
        saveStatus = 'Estado registrado apenas localmente; confirmação remota pendente.';
      } else {
        saveStatus = 'Estado não confirmado pelo serviço.';
      }
    } catch (error) {
      saveStatus = statusOf(error) === 409
        ? 'Conflito de estado: outra sessão alterou este leitor. As abas locais foram preservadas; nada foi sobrescrito.'
        : `Não foi possível salvar o estado: ${messageOf(error)}`;
      if (active) render();
    } finally {
      saving = false;
      if (queuedSave && active) { queuedSave = false; scheduleSave(); }
    }
  }

  function switchTab(id: string): void {
    if (id === activeTabId) return;
    activeTabId = id;
    const tab = activeTab();
    if (tab && tab.kind === 'unit') currentUnitId = tab.objectId;
    selAnchor = null;
    selMatches = [];
    openForm = null;
    replyTo = null;
    scheduleSave();
    pendingFocus = `[data-action="switch-tab"][data-tab="${id}"]`;
    render();
  }

  function openTab(kind: ReaderTab['kind'], objectId: string, title: string, revision: number, opts: { anchor?: Anchor | null; origin?: Anchor | null } = {}): ReaderTab {
    const previous = activeTabId;
    const existing = tabs.find(t => t.kind === kind && t.objectId === objectId && t.kind !== 'source');
    const sourceExisting = kind === 'source' ? tabs.find(t => t.kind === 'source' && t.objectId === objectId) : null;
    const tab = existing || sourceExisting;
    if (tab) {
      tab.title = title;
      tab.revision = revision;
      if (opts.anchor) tab.anchor = opts.anchor;
      if (opts.origin !== undefined) tab.origin = opts.origin;
      activeTabId = tab.id;
    } else {
      if (tabs.length >= 40) {
        const drop = tabs.findIndex(t => t.kind !== 'unit' && t.id !== activeTabId);
        if (drop >= 0) tabs.splice(drop, 1);
        else { announce('Limite de abas atingido.'); return tabs.find(t => t.id === activeTabId)!; }
      }
      const created: ReaderTab = {
        id: uid(), kind, title, objectId, revision: Math.max(1, revision), position: 0,
        origin: opts.origin ?? null, anchor: opts.anchor ?? null,
      };
      tabs.push(created);
      activeTabId = created.id;
      if (previous) originLinks.set(created.id, previous);
    }
    if (previous && previous !== activeTabId) originLinks.set(activeTabId, previous);
    scheduleSave();
    pendingFocus = '[data-role="main"]';
    render();
    return tab || tabs.find(t => t.id === activeTabId)!;
  }

  function closeTab(id: string): void {
    if (tabs.length <= 1) { announce('Mantenha ao menos uma aba aberta.'); return; }
    const position = tabs.findIndex(t => t.id === id);
    if (position < 0) return;
    tabs.splice(position, 1);
    originLinks.delete(id);
    if (!tabs.some(t => t.kind === 'unit')) {
      const unitTab = makeUnitTab(currentUnitId);
      tabs.unshift(unitTab);
      activeTabId = unitTab.id;
    } else if (activeTabId === id) {
      activeTabId = tabs[Math.max(0, position - 1)]?.id || tabs[0].id;
    }
    selAnchor = null;
    selMatches = [];
    scheduleSave();
    pendingFocus = `[data-action="switch-tab"][data-tab="${activeTabId}"]`;
    render();
  }

  function returnToOrigin(): void {
    const tab = activeTab();
    if (!tab) return;
    const linked = originLinks.get(tab.id);
    if (linked && tabs.some(t => t.id === linked)) { switchTab(linked); announce('Origem restaurada.'); return; }
    const unitTab = tabs.find(t => t.kind === 'unit');
    if (unitTab) { switchTab(unitTab.id); announce('Origem restaurada na unidade.'); return; }
    announce('Origem não está mais aberta.');
  }

  function switchUnit(unitId: string): void {
    if (!units.some(u => u.id === unitId)) return;
    currentUnitId = unitId;
    const found = tabs.find(t => t.kind === 'unit');
    let unitTabId: string;
    if (!found) {
      const created = makeUnitTab(unitId);
      tabs.unshift(created);
      unitTabId = created.id;
    } else {
      found.objectId = unitId;
      found.title = unitTitle(unitId);
      found.revision = revisionFor(unitId);
      found.position = 0;
      unitTabId = found.id;
    }
    activeTabId = unitTabId;
    practice = null;
    selAnchor = null;
    selMatches = [];
    openForm = null;
    forceScrollTop = true;
    scheduleSave();
    pendingFocus = '#unit-title';
    render();
  }

  async function locateBlock(tabId: string, anchor: Anchor): Promise<void> {
    const limit = SOURCE_LIMIT;
    let offset = 0;
    for (let guard = 0; guard < 30; guard += 1) {
      let page: SourcePage;
      try { page = await sourcePage(anchor.sourceId, anchor.sourceRevision, offset, limit); }
      catch (error) { sourceErrors.set(pageKey(anchor.sourceId, anchor.sourceRevision, offset, limit), messageOf(error)); break; }
      if (page.blocks.some(b => b.id === anchor.elementId)) {
        sourceOffsets.set(tabId, offset);
        if (active) { forceScrollTop = true; render(); }
        return;
      }
      if (!hasNext(page)) break;
      offset = nextOffset(page);
    }
    sourceOffsets.set(tabId, 0);
    if (active) render();
  }

  function openSourceAt(anchor: Anchor, originTabId: string): void {
    const meta = sourceEntry(anchor.sourceId, anchor.sourceRevision);
    const tab = openTab('source', anchor.sourceId, meta?.title || 'Fonte', anchor.sourceRevision, { anchor, origin: anchor });
    if (originTabId) originLinks.set(tab.id, originTabId);
    sourceOffsets.set(tab.id, 0);
    void locateBlock(tab.id, anchor);
  }

  function readField(button: HTMLElement, name: string): string {
    const scope = button.closest('[data-form-block]') || rootEl;
    const field = scope.querySelector(`[data-field="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
    return field?.value?.trim() || '';
  }

  function setSection(section: string): void {
    if (sectionOpen.has(section)) sectionOpen.delete(section); else sectionOpen.add(section);
    pendingFocus = sectionOpen.has(section)
      ? `[data-section-content="${section}"]`
      : `[data-action="toggle-section"][data-section="${section}"]`;
    render();
  }

  async function runSequence(errorsOnly: boolean): Promise<void> {
    if (personalStale) { announce('Prática pessoal indisponível enquanto a base do complemento divergir da base comum.'); return; }
    practiceLoading = true;
    practice = null;
    render();
    try {
      const result = await api('choice_sequence', { projectId, profileId, errorsOnly, unitId: currentUnitId });
      const questions: Choice[] = Array.isArray(result?.questions) ? result.questions : [];
      practice = {
        unitId: currentUnitId, sequenceId: uid(), questions, index: 0,
        bundleRevision: Number(result?.revision) || commonManifest?.revision || 1,
        errorsOnly, feedback: null, error: null, finished: false,
      };
    } catch (error) {
      practice = {
        unitId: currentUnitId, sequenceId: uid(), questions: [], index: 0,
        bundleRevision: commonManifest?.revision || 1, errorsOnly, feedback: null, error: messageOf(error), finished: false,
      };
    }
    practiceLoading = false;
    pendingFocus = '[data-role="practice-feedback"]';
    render();
  }

  function applyAttempt(result: any, optionId: string): void {
    if (!practice) return;
    practice.feedback = {
      optionId,
      correct: result?.correct === true,
      feedback: typeof result?.feedback === 'string' ? result.feedback : '',
    };
    practice.error = null;
    announce(practice.feedback.correct ? 'Resposta registrada como correta.' : 'Resposta registrada como incorreta.');
    pendingFocus = '[data-role="practice-feedback"]';
    render();
  }

  function writeNotice(receipt:any,confirmed:string){const outcome=outcomeOf(receipt);if(outcome.state==='confirmed')announce(confirmed);else if(outcome.state==='pending'){saveStatus='Alteração salva neste dispositivo; confirmação remota pendente.';announce(saveStatus);}else throw new Error('Operação sem confirmação.');}

  async function answer(optionId: string): Promise<void> {
    if (!practice || practice.feedback) return;
    const question = practice.questions[practice.index];
    if (!question) return;
    const key = `${practice.sequenceId}|${question.id}|${optionId}`;
    let operationId = practiceOps.get(key);
    if (!operationId) { operationId = uid(); practiceOps.set(key, operationId); practiceDates.set(operationId,new Date().toISOString()); }
    practice.error = null;
    render();
    try {
      const result = await api('attempt_submit', {
        operationId, projectId, profileId, bundleRevision: practice.bundleRevision,
        questionId: question.id, questionRevision: question.revision, optionId,
        sequenceId: practice.sequenceId, createdAt: practiceDates.get(operationId),
      });
      const outcome=outcomeOf(result);
      if(outcome.state==='unknown')throw new Error('Resposta não confirmada.');
      applyAttempt(outcome.result, optionId);
      if(outcome.state==='pending'){saveStatus='Resposta salva neste dispositivo; confirmação remota pendente.';announce(saveStatus);render();}
    } catch (error) {
      try {
        const state = await api('operation_get', { operationId });
        const confirmed = state?.status === 'confirmed';
        if (confirmed && state?.result) { applyAttempt(state.result, optionId); return; }
      } catch { /* report original failure */ }
      if (practice) {
        practice.error = `Não foi possível registrar a resposta: ${messageOf(error)}`;
        announce(practice.error);
        render();
      }
    }
  }

  function nextQuestion(): void {
    if (!practice) return;
    if (practice.index + 1 < practice.questions.length) {
      practice.index += 1;
      practice.feedback = null;
      practice.error = null;
      pendingFocus = '[data-role="practice-question"]';
    } else {
      practice.finished = true;
      pendingFocus = '[data-role="practice-feedback"]';
    }
    render();
  }

  async function shareNote(button: HTMLElement): Promise<void> {
    const recordId = button.dataset.record || '';
    const revision = Number(button.dataset.revision) || 0;
    try {
      const receipt=await api('note_share', { operationId: uid(), projectId, profileId, recordId, expectedRevision: revision });
      sharedNotes.add(recordId);
      await loadComments();
      writeNotice(receipt,'Nota compartilhada como comentário.');
      pendingFocus = '[data-action="toggle-section"][data-section="comments"]';
      render();
    } catch (error) {
      announce(`Não foi possível compartilhar a nota: ${messageOf(error)}`);
    }
  }

  async function saveNote(): Promise<void> {
    if (!selAnchor) { announce('Selecione um trecho da fonte antes de salvar a nota.'); return; }
    const saveButton = rootEl.querySelector('[data-action="save-note"]') as HTMLElement | null;
    const text = readField(saveButton || rootEl, 'note-text');
    if (!text) { announce('Escreva a nota antes de salvar.'); return; }
    try {
      const receipt=await api('note_save', { operationId: uid(), projectId, profileId, recordId: uid(), expectedRevision: 0, anchor: selAnchor, text });
      notes = await loadRecords('note');
      openForm = null;
      writeNotice(receipt,'Nota privada salva.');
      pendingFocus = '[data-action="capture-selection"]';
      render();
    } catch (error) { announce(`Não foi possível salvar a nota: ${messageOf(error)}`); }
  }

  async function saveTerm(): Promise<void> {
    if (!selAnchor) { announce('Selecione um trecho da fonte antes de salvar o vocabulário.'); return; }
    const scope = (rootEl.querySelector('[data-action="save-term"]') as HTMLElement | null) || rootEl;
    const term = readField(scope, 'term');
    const definition = readField(scope, 'definition');
    if (!term || !definition) { announce('Informe o termo e a definição.'); return; }
    try {
      const receipt=await api('term_save', { operationId: uid(), projectId, profileId, recordId: uid(), expectedRevision: 0, anchor: selAnchor, term, definition });
      terms = await loadRecords('term');
      openForm = null;
      writeNotice(receipt,'Vocabulário privado salvo.');
      pendingFocus = '[data-action="capture-selection"]';
      render();
    } catch (error) { announce(`Não foi possível salvar o vocabulário: ${messageOf(error)}`); }
  }

  async function saveObservation(): Promise<void> {
    if (!selAnchor) { announce('Selecione um trecho da fonte antes de registrar a observação.'); return; }
    const saveButton = rootEl.querySelector('[data-action="save-observation"]') as HTMLElement | null;
    const text = readField(saveButton || rootEl, 'observation-text');
    if (!text) { announce('Escreva a observação antes de registrar.'); return; }
    try {
      const receipt=await api('observation_add', { operationId: uid(), projectId, observationId: uid(), target: selAnchor, text });
      await loadObservations();
      openForm = null;
      writeNotice(receipt,'Observação registrada.');
      pendingFocus = '[data-action="capture-selection"]';
      render();
    } catch (error) { announce(`Não foi possível registrar a observação: ${messageOf(error)}`); }
  }

  async function saveComment(): Promise<void> {
    if (!selAnchor) { announce('Selecione um trecho da fonte antes de comentar.'); return; }
    const saveButton = rootEl.querySelector('[data-action="save-comment"]') as HTMLElement | null;
    const text = readField(saveButton || rootEl, 'comment-text');
    if (!text) { announce('Escreva o comentário antes de enviar.'); return; }
    try {
      const receipt=await api('comment_add', { operationId: uid(), projectId, commentId: uid(), target: selAnchor, text, replyTo: null });
      await loadComments();
      openForm = null;
      writeNotice(receipt,'Comentário enviado.');
      pendingFocus = '[data-action="capture-selection"]';
      render();
    } catch (error) { announce(`Não foi possível enviar o comentário: ${messageOf(error)}`); }
  }

  async function saveReply(button: HTMLElement): Promise<void> {
    const parent = comments.find(c => c.id === button.dataset.comment);
    const target = targetOf(parent?.target);
    if (!parent || !target) { announce('Comentário de origem indisponível.'); return; }
    const text = readField(button, 'reply-text');
    if (!text) { announce('Escreva a resposta antes de enviar.'); return; }
    try {
      const receipt=await api('comment_add', { operationId: uid(), projectId, commentId: uid(), target, text, replyTo: parent.id });
      await loadComments();
      replyTo = null;
      writeNotice(receipt,'Resposta enviada.');
      pendingFocus = `[data-action="reply-comment"][data-comment="${parent.id}"]`;
      render();
    } catch (error) { announce(`Não foi possível responder: ${messageOf(error)}`); }
  }

  function blockElement(node: Node | null): HTMLElement | null {
    if (!node) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    return element?.closest?.('.source-block[data-block-id]') as HTMLElement | null;
  }

  function utf16Length(block: HTMLElement, node: Node, offset: number): number {
    const range = document.createRange();
    range.selectNodeContents(block);
    range.setEnd(node, offset);
    return range.toString().length;
  }

  async function captureSelection(manual: boolean): Promise<void> {
    const tab = activeTab();
    if (!tab || tab.kind !== 'source') {
      if (manual) announce('Abra uma fonte para selecionar um trecho.');
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      if (manual) announce('Selecione um trecho dentro de um bloco da fonte.');
      return;
    }
    const range = selection.getRangeAt(0);
    const startBlock = blockElement(range.startContainer);
    const endBlock = blockElement(range.endContainer);
    if (!startBlock || !endBlock || startBlock !== endBlock) {
      if (manual) announce('Selecione um trecho dentro de um único bloco da fonte.');
      return;
    }
    if (!rootEl.contains(startBlock)) return;
    const text = startBlock.textContent || '';
    const startUtf16 = utf16Length(startBlock, range.startContainer, range.startOffset);
    const endUtf16 = utf16Length(startBlock, range.endContainer, range.endOffset);
    if (endUtf16 <= startUtf16) {
      if (manual) announce('A seleção está vazia.');
      return;
    }
    let start: number;
    let end: number;
    try {
      start = utf16ToCodePoint(text, startUtf16);
      end = utf16ToCodePoint(text, endUtf16);
    } catch (error) {
      announce(`Seleção inválida: ${messageOf(error)}`);
      return;
    }
    const points = Array.from(text);
    const exact = points.slice(start, end).join('');
    if (!exact) { announce('A seleção está vazia.'); return; }
    const offset = sourceOffsets.get(tab.id) || 0;
    const page = sourcePages.get(pageKey(tab.objectId, tab.revision, offset, SOURCE_LIMIT));
    const block = page?.blocks.find(b => b.id === startBlock.dataset.blockId);
    const anchor: Anchor = {
      sourceId: tab.objectId, sourceRevision: tab.revision,
      elementId: startBlock.dataset.blockId || '',
      start, end, exact,
      prefix: points.slice(Math.max(0, start - 24), start).join(''),
      suffix: points.slice(end, Math.min(points.length, end + 24)).join(''),
      ...(block?.locator ? { locator: block.locator } : {}),
    };
    await loadAllResources();
    selAnchor = anchor;
    selMatches = selectionMatches(anchor, resources.map(resource => ({ id: resource.id, targets: resource.targets || [] })));
    openForm = null;
    announce(`Seleção capturada. ${selMatches.length} recurso(s) preparado(s) contêm este trecho.`);
    pendingFocus = '[data-action="capture-selection"]';
    render();
  }

  function focusAfterRender(): void {
    if (!pendingFocus) return;
    const selector = pendingFocus;
    pendingFocus = null;
    const target = rootEl.querySelector(selector) as HTMLElement | null;
    if (target) target.focus();
    else (rootEl.querySelector('[data-role="main"]') as HTMLElement | null)?.focus();
  }

  // ---------- render ----------

  function render(): void {
    if (!active) return;
    uiAnchors.clear();
    const previousMain = rootEl.querySelector('.reader-main') as HTMLElement | null;
    const previousScroll = previousMain?.scrollTop || 0;
    const tabChanged = lastTabRendered !== activeTabId;
    const tab = activeTab();
    let body = '';
    if (fatalError) body = `<section class="reader-card" role="alert"><h2>Leitor indisponível</h2><p>${h(fatalError)}</p><button type="button" class="control" data-action="exit">Sair do leitor</button></section>`;
    else if (!booted) body = `<div class="reader-loading" role="status">Carregando leitor…</div>`;
    else if (!tab) body = `<div class="reader-loading">Nenhuma aba aberta.</div>`;
    else if (tab.kind === 'unit') body = renderUnit(tab);
    else if (tab.kind === 'resource') body = renderResourceTab(tab);
    else if (tab.kind === 'sources') body = renderSourcesTab(tab);
    else body = renderSourceTab(tab);

    const statuses: string[] = [];
    if (personalError) statuses.push(`Complemento pessoal indisponível: ${personalError}`);
    if (saveStatus) statuses.push(saveStatus);
    if (recordErrors.get('state')) statuses.push(`Estado não restaurado: ${recordErrors.get('state')}`);
    if (recordErrors.get('comments')) statuses.push(`Comentários indisponíveis: ${recordErrors.get('comments')}`);
    if (recordErrors.get('observations')) statuses.push(`Observações indisponíveis: ${recordErrors.get('observations')}`);

    const originVisible = Boolean(tab && (tab.origin || originLinks.has(tab.id)));
    rootEl.innerHTML = `
      <section class="reader-shell" aria-label="Leitor de estudo">
        <header class="reader-head">
          <div class="reader-heading">
            <span class="reader-eyebrow">Leitor</span>
            <h1>${h(tab?.title || 'Estudo')}</h1>
          </div>
          <div class="reader-head-actions">
            ${originVisible ? iconButton('reposition', 'Voltar à origem', 'tab-origin') : ''}
            ${iconButton('arrow-left', 'Sair do leitor', 'exit')}
          </div>
        </header>
        <div class="reader-status" role="status" aria-live="polite">${h(statuses.join(' · '))}</div>
        ${booted ? renderTabStrip() : ''}
        <main class="reader-main" data-role="main" tabindex="-1">${body}</main>
      </section>`;

    const main = rootEl.querySelector('[data-role="main"]') as HTMLElement | null;
    if (main) {
      const desired = forceScrollTop ? 0 : tabChanged ? (tab?.position || 0) : previousScroll;
      main.scrollTop = Math.max(0, desired);
    }
    forceScrollTop = false;
    lastTabRendered = activeTabId;
    focusAfterRender();
  }

  function renderTabStrip(): string {
    return `<nav class="tabstrip" role="tablist" aria-label="Abas abertas">
      ${tabs.map(tab => `<span class="tab" data-active="${tab.id === activeTabId}">
        <button type="button" class="tab-activate" role="tab" aria-selected="${tab.id === activeTabId}" data-action="switch-tab" data-tab="${h(tab.id)}" title="${h(tab.title)}">${h(tab.title)}</button>
        ${iconButton('remove-state', 'Fechar aba', 'close-tab', `data-tab="${h(tab.id)}"`)}
      </span>`).join('')}
    </nav>`;
  }

  function renderUnit(tab: ReaderTab): string {
    const unit = contentCache.get(tab.objectId) as StudyUnit | undefined;
    if (!unit) {
      ensureContent(tab.objectId);
      if (contentErrors.get(tab.objectId)) return `<section class="reader-card" role="alert"><h2>Unidade indisponível</h2><p>${h(contentErrors.get(tab.objectId))}</p></section>`;
      return `<div class="reader-loading" role="status">Carregando unidade…</div>`;
    }
    const groups = groupsFor(unit);
    return `
      <section class="reader-card unit-card" aria-labelledby="unit-title">
        <div class="unit-toolbar">
          <label class="field-label" for="unit-select">Unidade</label>
          <select id="unit-select" class="field-select" data-role="unit-select" aria-label="Trocar unidade">
            ${units.map(entry => `<option value="${h(entry.id)}" ${entry.id === unit.id ? 'selected' : ''}>${h(entry.title)}</option>`).join('')}
          </select>
        </div>
        <h2 id="unit-title" tabindex="-1">${h(unit.title)}</h2>
        <div class="reader-body" dir="auto">${renderBody(unit.body)}</div>
      </section>
      <section class="reader-card">
        <div class="section-head"><h2>Referências documentais</h2><span class="count">${groups.length} passagem(ns)</span></div>
        <p class="muted">As passagens citadas ficam agrupadas por passagem na aba de fontes. Relações são apenas as declaradas.</p>
        <button type="button" class="control" data-action="open-sources" data-unit="${h(unit.id)}">Abrir fontes</button>
      </section>
      ${renderResourcesSection(unit)}
      ${renderPracticeSection()}
      ${renderNotesSection()}
      ${renderTermsSection()}
      ${renderObservationsSection()}
      ${renderCommentsSection()}
    `;
  }

  function sectionWrap(section: string, title: string, count: number, content: string): string {
    const open = sectionOpen.has(section);
    return `<section class="reader-card">
      <button type="button" class="section-toggle" data-action="toggle-section" data-section="${section}" aria-expanded="${open}">
        <span>${h(title)}</span><span class="count">${count}</span>
      </button>
      ${open ? `<div class="section-content" data-section-content="${section}" tabindex="-1">${content}</div>` : ''}
    </section>`;
  }

  function unitResources(unit: StudyUnit): Resource[] {
    const anchors = groupsFor(unit).map(g => g.anchor);
    return resources.filter(resource => (resource.targets || []).some(target => anchors.some(anchor =>
      target.sourceId === anchor.sourceId && target.sourceRevision === anchor.sourceRevision
      && target.elementId === anchor.elementId && target.start < anchor.end && anchor.start < target.end)));
  }

  function renderResourcesSection(unit: StudyUnit): string {
    const prepared = resourcesLoaded ? unitResources(unit) : [];
    let content = '';
    if (!resourcesLoaded) content = `<p class="muted" role="status">Carregando recursos preparados…</p>`;
    else if (!prepared.length) content = `<p class="muted">Nenhum recurso preparado para as passagens desta unidade.</p>`;
    else content = prepared.map(resource => `<article class="resource-card">
      <div class="record-head"><h3>${h(resource.title)}</h3><span class="badge">${h(RESOURCE_TYPE[resource.type] || resource.type)}</span></div>
      <p class="muted">${h(resource.purpose)}</p>
      ${resource.inspection === 'pending' ? '<p class="warning">Inspeção pendente.</p>' : ''}
      <button type="button" class="control" data-action="open-resource" data-resource="${h(resource.id)}">Abrir recurso</button>
    </article>`).join('');
    return sectionWrap('resources', 'Recursos preparados', prepared.length, content);
  }

  function renderPracticeSection(): string {
    let content = '';
    if (practiceLoading) content = `<p class="muted" role="status">Carregando prática…</p>`;
    else if (practice && practice.unitId === currentUnitId) content = renderPractice();
    else content = `<div class="button-row">
      <button type="button" class="control" data-action="practice-start" data-errors="false">Praticar todas</button>
      <button type="button" class="control" data-action="practice-start" data-errors="true">Refazer erros</button>
    </div><p class="muted">A prática é separada da leitura e não avança a unidade.</p>`;
    return sectionWrap('practice', 'Prática', practice?.questions.length || 0, content);
  }

  function renderPractice(): string {
    if (!practice) return '';
    if (practice.error) {
      return `<div class="practice-card" role="alert"><p class="warning">${h(practice.error)}</p>
        <div class="button-row">
          <button type="button" class="control" data-action="practice-start" data-errors="${practice.errorsOnly}">Tentar novamente</button>
          <button type="button" class="control" data-action="practice-start" data-errors="false">Praticar todas</button>
        </div></div>`;
    }
    if (practice.finished) {
      return `<div class="practice-card" data-role="practice-feedback" tabindex="-1"><h3>Sequência concluída</h3>
        <p class="muted">A unidade permanece na mesma posição.</p>
        <div class="button-row">
          <button type="button" class="control" data-action="practice-start" data-errors="false">Refazer todas</button>
          <button type="button" class="control" data-action="practice-start" data-errors="true">Refazer erros</button>
        </div></div>`;
    }
    const question = practice.questions[practice.index];
    if (!question) {
      return `<div class="practice-card"><p class="muted">${practice.errorsOnly ? 'Nenhum erro pendente nesta sequência.' : 'Nenhuma questão disponível para esta unidade.'}</p>
        <button type="button" class="control" data-action="practice-start" data-errors="false">Praticar todas</button></div>`;
    }
    const feedback = practice.feedback;
    return `<div class="practice-card" data-role="practice-question" tabindex="-1">
      <div class="record-head"><h3>Questão ${practice.index + 1} de ${practice.questions.length}</h3><span class="badge">${practice.errorsOnly ? 'Erros' : 'Sequência'}</span></div>
      <p class="practice-prompt" dir="auto">${h(question.prompt)}</p>
      <div class="practice-options">
        ${(question.options || []).map(option => `<button type="button" class="practice-option" data-action="practice-answer" data-option="${h(option.id)}" ${feedback ? 'disabled' : ''}>${h(option.text)}</button>`).join('')}
      </div>
      ${feedback ? `<div class="practice-feedback" data-role="practice-feedback" tabindex="-1" role="status">
        <p><strong>${feedback.correct ? 'Correto.' : 'Incorreto.'}</strong> ${h(feedback.feedback)}</p>
        <button type="button" class="control" data-action="practice-next">${practice.index + 1 < practice.questions.length ? 'Próxima questão' : 'Concluir sequência'}</button>
      </div>` : ''}
      ${practice.error ? `<p class="warning" role="alert">${h(practice.error)}</p>` : ''}
    </div>`;
  }

  function renderNotesSection(): string {
    const content = notes.length ? notes.map(item => {
      const data = dataOf(item) || {};
      const anchor = targetOf(data.anchor);
      const review = data.anchorStatus === 'needs_review';
      return `<article class="record-card">
        <p class="quote">${h(anchor?.exact || 'Trecho indisponível')}</p>
        ${review ? `<p class="warning">Revisão pendente. Trecho anterior preservado: “${h(anchor?.exact || '')}”.</p>` : ''}
        <p class="record-text" dir="auto">${h(data.text || '')}</p>
        <div class="button-row">
          ${anchor ? `<button type="button" class="control" data-action="open-record-source" data-anchor="${anchorRef(anchor)}">Ver no contexto</button>` : ''}
          <button type="button" class="control" data-action="share-note" data-record="${h(item.id)}" data-revision="${Number(item.revision) || 0}" ${sharedNotes.has(item.id) ? 'disabled' : ''}>${sharedNotes.has(item.id) ? 'Compartilhada' : 'Compartilhar como comentário'}</button>
        </div>
      </article>`;
    }).join('') : `<p class="muted">${recordErrors.get('note') ? `Notas indisponíveis: ${h(recordErrors.get('note'))}` : 'Nenhuma nota privada.'}</p>`;
    return sectionWrap('notes', 'Notas privadas', notes.length, content);
  }

  function renderTermsSection(): string {
    const content = terms.length ? terms.map(item => {
      const data = dataOf(item) || {};
      const anchor = targetOf(data.anchor);
      return `<article class="record-card">
        <div class="record-head"><h3>${h(data.term || '')}</h3>${data.anchorStatus === 'needs_review' ? '<span class="badge">Revisão pendente</span>' : ''}</div>
        <p class="quote">${h(anchor?.exact || 'Trecho indisponível')}</p>
        ${data.anchorStatus === 'needs_review' ? `<p class="warning">Trecho anterior preservado: “${h(anchor?.exact || '')}”.</p>` : ''}
        <p class="record-text" dir="auto">${h(data.definition || '')}</p>
        ${anchor ? `<button type="button" class="control" data-action="open-record-source" data-anchor="${anchorRef(anchor)}">Ver no contexto</button>` : ''}
      </article>`;
    }).join('') : `<p class="muted">${recordErrors.get('term') ? `Vocabulário indisponível: ${h(recordErrors.get('term'))}` : 'Nenhum termo salvo.'}</p>`;
    return sectionWrap('terms', 'Vocabulário', terms.length, content);
  }

  function renderObservationsSection(): string {
    const content = observations.length ? observations.map(item => {
      const target = targetOf(item.target);
      return `<article class="record-card">
        <div class="record-head"><h3>Observação</h3><span class="badge">${h(item.status || 'aberta')}</span></div>
        <p class="quote">${h(target?.exact || 'Trecho indisponível')}</p>
        <p class="record-text" dir="auto">${h(item.text || '')}</p>
        ${item.result ? `<p class="muted">Resultado: ${h(item.result)}</p>` : ''}
      </article>`;
    }).join('') : `<p class="muted">${recordErrors.get('observations') ? `Observações indisponíveis: ${h(recordErrors.get('observations'))}` : 'Nenhuma observação registrada.'}</p>`;
    return sectionWrap('observations', 'Observações', observations.length, content);
  }

  function renderCommentsSection(): string {
    const parents = comments.filter(c => !c.reply_to);
    const replies = comments.filter(c => c.reply_to);
    const block = (comment: any, depth: number): string => {
      const target = targetOf(comment.target);
      const children = replies.filter(reply => reply.reply_to === comment.id);
      return `<article class="comment ${depth ? 'comment-reply' : ''}">
        <div class="record-head"><h3>${h(comment.account_id || comment.author_id || comment.authorId || 'Autor não informado')}</h3>${target?.exact ? '<span class="badge">Passagem</span>' : ''}</div>
        ${target?.exact ? `<p class="quote">${h(target.exact)}</p>` : ''}
        <p class="record-text" dir="auto">${h(comment.text || '')}</p>
        <button type="button" class="control" data-action="reply-comment" data-comment="${h(comment.id)}" aria-expanded="${replyTo === comment.id}">Responder</button>
        ${replyTo === comment.id ? `<div class="reply-form" data-form-block>
          <label class="field-label" for="reply-text-${h(comment.id)}">Resposta</label>
          <textarea id="reply-text-${h(comment.id)}" class="field-input" data-field="reply-text" rows="3"></textarea>
          <button type="button" class="control" data-action="save-reply" data-comment="${h(comment.id)}">Enviar resposta</button>
        </div>` : ''}
        ${children.map(child => block(child, depth + 1)).join('')}
      </article>`;
    };
    const content = parents.length ? parents.map(comment => block(comment, 0)).join('')
      : `<p class="muted">${recordErrors.get('comments') ? `Comentários indisponíveis: ${h(recordErrors.get('comments'))}` : 'Nenhum comentário.'}</p>`;
    return sectionWrap('comments', 'Comentários', parents.length, content);
  }

  function renderResourceTab(tab: ReaderTab): string {
    const resource = contentCache.get(tab.objectId) as Resource | undefined;
    if (!resource) {
      ensureContent(tab.objectId);
      if (contentErrors.get(tab.objectId)) return `<section class="reader-card" role="alert"><h2>Recurso indisponível</h2><p>${h(contentErrors.get(tab.objectId))}</p></section>`;
      return `<div class="reader-loading" role="status">Carregando recurso…</div>`;
    }
    const targetLinks = (resource.targets || []).map(anchor => `<button type="button" class="control" data-action="open-record-source" data-anchor="${anchorRef(anchor)}">Passagem: ${h(anchor.exact.slice(0, 60))}${anchor.exact.length > 60 ? '…' : ''}</button>`).join('');
    return `<section class="reader-card">
      <div class="record-head"><h2>${h(resource.title)}</h2><span class="badge">${h(RESOURCE_TYPE[resource.type] || resource.type)}</span></div>
      <p class="muted">${h(resource.purpose)}</p>
      ${resource.inspection === 'pending' ? '<p class="warning">Inspeção pendente. O recurso não foi declarado inspecionado.</p>' : ''}
      <div class="reader-body" dir="auto">${renderBody(resource.body)}</div>
    </section>
    <section class="reader-card"><h2>Passagens preparadas</h2><div class="button-row">${targetLinks || '<p class="muted">Nenhuma passagem preparada.</p>'}</div></section>`;
  }

  function renderSourcesTab(tab: ReaderTab): string {
    const unit = contentCache.get(tab.objectId) as StudyUnit | undefined;
    if (!unit) {
      ensureContent(tab.objectId);
      if (contentErrors.get(tab.objectId)) return `<section class="reader-card" role="alert"><h2>Fontes indisponíveis</h2><p>${h(contentErrors.get(tab.objectId))}</p></section>`;
      return `<div class="reader-loading" role="status">Carregando fontes…</div>`;
    }
    const groups = groupsFor(unit);
    if (!groups.length) return `<section class="reader-card"><h2>Fontes de ${h(unit.title)}</h2><p class="muted">A unidade não declara passagens documentais.</p></section>`;
    const articles = groups.map(group => {
      const anchor = group.anchor;
      ensureSourcePage(anchor.sourceId, anchor.sourceRevision, 0, FULL_LIMIT);
      const key = pageKey(anchor.sourceId, anchor.sourceRevision, 0, FULL_LIMIT);
      if (sourceErrors.get(key)) return `<article class="passage-card"><p class="warning">${h(sourceErrors.get(key))}</p><p class="quote">${h(anchor.exact)}</p></article>`;
      const page = sourcePages.get(key);
      const meta = metaFor(anchor.sourceId, anchor.sourceRevision);
      const open = contextOpen.has(group.key);
      const block = page?.blocks.find(b => b.id === anchor.elementId);
      let context = '';
      if (open) {
        if (!page) context = '<p class="muted" role="status">Carregando contexto…</p>';
        else if (!block) context = '<p class="warning">Contexto não localizado nesta página da fonte.</p>';
        else {
          const at = page.blocks.indexOf(block);
          context = `<div class="source-context">${page.blocks.slice(Math.max(0, at - 1), at + 2).map(b => `<div class="source-block source-${h(b.kind || 'unknown')}" dir="auto">${h(b.text)}</div>`).join('')}</div>`;
        }
      }
      return `<article class="passage-card">
        <div class="record-head"><h3>${h(meta.title)}</h3><span class="badge">${h(NATURE[meta.nature] || meta.nature || 'Natureza não informada')}</span></div>
        <p class="meta-line">${meta.language ? `Idioma: ${h(meta.language)} · ` : ''}${anchor.locator ? `Local: ${h(anchor.locator)} · ` : ''}Relação: ${[...group.relations].map(r => h(RELATION[r] || r)).join(', ')}</p>
        <p class="quote" dir="auto">${h(anchor.exact)}</p>
        <p class="muted">${group.provenance.map(p => h(PROVENANCE[p?.kind] || p?.kind || 'Proveniência')).filter(Boolean).join(' · ')}</p>
        ${group.provenance.some(p => (p?.limitations || []).length) ? `<p class="muted">Limites: ${group.provenance.flatMap(p => p?.limitations || []).map(h).join('; ')}</p>` : ''}
        <div class="button-row">
          <button type="button" class="control" data-action="toggle-context" data-group="${h(group.key)}" aria-expanded="${open}">${open ? 'Recolher contexto' : 'Expandir contexto'}</button>
          <button type="button" class="control" data-action="open-source" data-anchor="${anchorRef(anchor)}">Abrir fonte</button>
        </div>
        ${context}
      </article>`;
    }).join('');
    return `<section class="reader-card"><h2>Fontes de ${h(unit.title)}</h2><p class="muted">${groups.length} passagem(ns) agrupada(s). Nenhum alinhamento é inferido.</p></section>${articles}`;
  }

  function renderSourceTab(tab: ReaderTab): string {
    const offset = sourceOffsets.get(tab.id) || 0;
    const key = pageKey(tab.objectId, tab.revision, offset, SOURCE_LIMIT);
    ensureSourcePage(tab.objectId, tab.revision, offset, SOURCE_LIMIT);
    if (sourceErrors.get(key)) return `<section class="reader-card" role="alert"><h2>Fonte indisponível</h2><p>${h(sourceErrors.get(key))}</p></section>`;
    const page = sourcePages.get(key);
    if (!page) return `<div class="reader-loading" role="status">Carregando fonte…</div>`;
    const meta = metaFor(tab.objectId, tab.revision);
    const review = tab.anchorStatus === 'needs_review';
    const blocks = page.blocks.map(block => {
      let content = h(block.text);
      const hit = tab.anchor;
      if (hit && hit.elementId === block.id) {
        const points = Array.from(block.text || '');
        content = `${h(points.slice(0, hit.start).join(''))}<mark class="source-hit">${h(points.slice(hit.start, hit.end).join(''))}</mark>${h(points.slice(hit.end).join(''))}`;
      }
      return `<div class="source-block source-${h(block.kind || 'unknown')}" data-block-id="${h(block.id)}" tabindex="0" dir="auto">${content}</div>`;
    }).join('');
    const next = hasNext(page) ? nextOffset(page) : null;
    return `<section class="reader-card source-card">
      <div class="record-head"><h2>${h(meta.title || page.title || tab.title)}</h2><span class="badge">${h(NATURE[meta.nature || page.nature] || meta.nature || page.nature || 'Natureza não informada')}</span></div>
      <p class="meta-line">${(meta.language || page.language) ? `Idioma: ${h(meta.language || page.language)} · ` : ''}Revisão ${h(tab.revision)}</p>
      ${review ? `<p class="warning">Âncora necessita revisão. Trecho anterior preservado: “${h(tab.anchor?.exact || '')}”.</p>` : ''}
      <div class="source-blocks">${blocks || '<p class="muted">Nenhum bloco nesta página.</p>'}</div>
      <div class="button-row">
        <button type="button" class="control" data-action="capture-selection">Usar seleção</button>
        ${offset > 0 ? `<button type="button" class="control" data-action="source-prev" data-tab="${h(tab.id)}" data-offset="${Math.max(0, offset - SOURCE_LIMIT)}">Anterior</button>` : ''}
        ${next !== null ? `<button type="button" class="control" data-action="source-next" data-tab="${h(tab.id)}" data-offset="${next}">Próxima</button>` : ''}
      </div>
      <p class="muted">Selecione texto com o mouse ou teclado dentro de um bloco. A seleção vira âncora com fonte, revisão e bloco.</p>
      ${renderSelectionPanel(tab)}
    </section>`;
  }

  function renderSelectionPanel(tab: ReaderTab): string {
    if (!selAnchor || selAnchor.sourceId !== tab.objectId || selAnchor.sourceRevision !== tab.revision) return '';
    const matches = selMatches.map(match => {
      const resource = resources.find(r => r.id === match.id);
      return `<article class="match-card">
        <div class="record-head"><h3>${h(resource?.title || 'Recurso')}</h3><span class="badge">${match.match === 'exact' ? 'exato' : 'contém'}</span></div>
        <p class="muted">${h(resource?.purpose || '')}</p>
        <button type="button" class="control" data-action="open-resource" data-resource="${h(match.id)}">Abrir recurso</button>
      </article>`;
    }).join('');
    const formBlock = (name: string, body: string) => `<div class="selection-form" data-form-block>
      <p class="field-label">${h(name)}</p>${body}
      <div class="button-row"><button type="button" class="control" data-action="toggle-form" data-form-name="${name}">Fechar</button></div>
    </div>`;
    let form = '';
    if (openForm === 'note') form = formBlock('Nota privada', `<label class="field-label" for="note-text">Texto da nota</label><textarea id="note-text" class="field-input" data-field="note-text" rows="4"></textarea><button type="button" class="control" data-action="save-note">Salvar nota</button>`);
    if (openForm === 'term') form = formBlock('Vocabulário', `<label class="field-label" for="term-field">Termo</label><input id="term-field" class="field-input" data-field="term"><label class="field-label" for="definition-field">Definição</label><textarea id="definition-field" class="field-input" data-field="definition" rows="4"></textarea><button type="button" class="control" data-action="save-term">Salvar vocabulário</button>`);
    if (openForm === 'observation') form = formBlock('Observação', `<label class="field-label" for="observation-text">Observação</label><textarea id="observation-text" class="field-input" data-field="observation-text" rows="4"></textarea><button type="button" class="control" data-action="save-observation">Registrar observação</button>`);
    if (openForm === 'comment') form = formBlock('Comentário', `<label class="field-label" for="comment-text">Comentário</label><textarea id="comment-text" class="field-input" data-field="comment-text" rows="4"></textarea><button type="button" class="control" data-action="save-comment">Enviar comentário</button>`);
    return `<section class="selection-panel" aria-labelledby="selection-title">
      <div class="section-head"><h3 id="selection-title">Seleção</h3><span class="badge">${selAnchor.exact.length} caractere(s)</span></div>
      <p class="quote" dir="auto">${h(selAnchor.exact)}</p>
      <p class="meta-line">Bloco ${h(selAnchor.elementId)} · posições ${selAnchor.start}–${selAnchor.end}</p>
      <div class="button-row">
        <button type="button" class="control" data-action="toggle-form" data-form-name="note" aria-expanded="${openForm === 'note'}">Nota privada</button>
        <button type="button" class="control" data-action="toggle-form" data-form-name="term" aria-expanded="${openForm === 'term'}">Vocabulário</button>
        <button type="button" class="control" data-action="toggle-form" data-form-name="observation" aria-expanded="${openForm === 'observation'}">Observação</button>
        <button type="button" class="control" data-action="toggle-form" data-form-name="comment" aria-expanded="${openForm === 'comment'}">Comentário</button>
      </div>
      ${form}
      <h4>Recursos correspondentes</h4>
      ${matches || '<p class="muted">Nenhum recurso preparado contém esta passagem. Nenhum recurso mais próximo foi escolhido.</p>'}
    </section>`;
  }

  // ---------- actions ----------

  async function handleAction(action: string, button: HTMLElement): Promise<void> {
    switch (action) {
      case 'exit':
        flushTime(true);
        await saveNow();
        onExit();
        return;
      case 'switch-tab': switchTab(button.dataset.tab || ''); return;
      case 'close-tab': closeTab(button.dataset.tab || ''); return;
      case 'tab-origin': returnToOrigin(); return;
      case 'open-sources': {
        const unitId = button.dataset.unit || currentUnitId;
        openTab('sources', unitId, `Fontes · ${unitTitle(unitId)}`, revisionFor(unitId));
        return;
      }
      case 'open-resource': {
        const id = button.dataset.resource || '';
        const entry = entryOf(id);
        if (!entry) { announce('Recurso indisponível.'); return; }
        openTab('resource', id, entry.title, revisionFor(id), { anchor: selAnchor || null, origin: selAnchor || null });
        return;
      }
      case 'open-record-source':
      case 'open-source': {
        const key = button.dataset.anchor || '';
        const anchor = uiAnchors.get(key);
        if (!anchor) { announce('Passagem indisponível.'); return; }
        openSourceAt(anchor, activeTabId);
        return;
      }
      case 'source-prev':
      case 'source-next': {
        const id = button.dataset.tab || '';
        const offset = Number(button.dataset.offset) || 0;
        sourceOffsets.set(id, Math.max(0, offset));
        const tab = tabs.find(t => t.id === id);
        if (tab) tab.position = 0;
        forceScrollTop = true;
        scheduleSave();
        pendingFocus = '[data-role="main"]';
        render();
        return;
      }
      case 'capture-selection': await captureSelection(true); return;
      case 'toggle-context': {
        const key = button.dataset.group || '';
        if (contextOpen.has(key)) contextOpen.delete(key); else contextOpen.add(key);
        pendingFocus = `[data-action="toggle-context"][data-group="${key}"]`;
        render();
        return;
      }
      case 'toggle-section': setSection(button.dataset.section || ''); return;
      case 'toggle-form': {
        const name = button.dataset.formName || '';
        openForm = openForm === name ? null : name;
        pendingFocus = openForm ? `[data-form-block] [data-field]` : `[data-action="toggle-form"][data-form-name="${name}"]`;
        render();
        return;
      }
      case 'practice-start': await runSequence(button.dataset.errors === 'true'); return;
      case 'practice-answer': await answer(button.dataset.option || ''); return;
      case 'practice-next': nextQuestion(); return;
      case 'share-note': await shareNote(button); return;
      case 'save-note': await saveNote(); return;
      case 'save-term': await saveTerm(); return;
      case 'save-observation': await saveObservation(); return;
      case 'save-comment': await saveComment(); return;
      case 'reply-comment': {
        const id = button.dataset.comment || '';
        replyTo = replyTo === id ? null : id;
        pendingFocus = `[data-field="reply-text"]`;
        render();
        return;
      }
      case 'save-reply': await saveReply(button); return;
      default: return;
    }
  }

  rootEl.addEventListener('click', event => {
    const target = (event.target as Element | null)?.closest?.('[data-action]') as HTMLElement | null;
    if (!target || !rootEl.contains(target)) return;
    event.preventDefault();
    void handleAction(target.dataset.action || '', target).catch(error => {
      announce(`Ação não concluída: ${messageOf(error)}`);
    });
  }, { signal });

  rootEl.addEventListener('change', event => {
    const target = event.target as HTMLElement | null;
    if (target?.matches('[data-role="unit-select"]')) switchUnit((target as HTMLSelectElement).value);
  }, { signal });

  rootEl.addEventListener('scroll', event => {
    const target = event.target as HTMLElement | null;
    if (!target?.classList?.contains('reader-main')) return;
    const tab = activeTab();
    if (!tab) return;
    tab.position = Math.max(0, target.scrollTop);
    scheduleSave();
  }, { capture: true, signal });

  const maybeSelection = () => {
    if (selectionTimer !== null) window.clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(() => {
      selectionTimer = null;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      if (activeTab()?.kind !== 'source') return;
      void captureSelection(false);
    }, 60);
  };
  rootEl.addEventListener('mouseup', maybeSelection, { signal });
  rootEl.addEventListener('keyup', event => {
    if ((event as KeyboardEvent).shiftKey) maybeSelection();
  }, { signal });

  document.addEventListener('visibilitychange', () => {
    visible = document.visibilityState === 'visible';
    lastTick = Date.now();
  }, { signal });
  window.addEventListener('focus', () => { focused = true; lastTick = Date.now(); }, { signal });
  window.addEventListener('blur', () => { focused = false; lastTick = Date.now(); }, { signal });

  rootEl.innerHTML = `<section class="reader-shell"><div class="reader-loading" role="status">Carregando leitor…</div></section>`;
  try {
    await boot();
  } catch (error) {
    fatalError = messageOf(error);
    announce(`Leitor indisponível: ${fatalError}`);
  }
  render();

  return () => {
    if (!active) return;
    flushTime(true);
    void saveNow();
    active = false;
    controller.abort();
    if (clockTimer !== null) window.clearInterval(clockTimer);
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    if (selectionTimer !== null) window.clearTimeout(selectionTimer);
    clockTimer = null;
    saveTimer = null;
    selectionTimer = null;
  };
}
