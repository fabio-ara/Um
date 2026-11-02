import './reader-view.css';
import { escapeHtml, iconButton, renderBody, announce, type StudyApi } from './dom.ts';
import {renderUiIcon} from './icons.js';
import { utf16ToCodePoint, selectionMatches } from '../anchors.ts';
import {foregroundSeconds,remainingMinutes,type TimeMode} from '../study-time.ts';
import type { Anchor, Choice, DocumentLink, ReaderTab, Resource, StudyUnit } from '../contracts.ts';

type Options = { projectId: string; profileId: string; api: StudyApi; onExit: () => void; onUpdate?:()=>Promise<void> };
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
type EditionTarget = { anchor: Anchor; relation: DocumentLink['relation']; linkId: string };
type ObservationGroup = { target: Anchor | null; items: any[] };
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
const RECORD_LIMIT = 100;
const MAX_RECORD_PAGES = 500;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uid = (): string => crypto.randomUUID();
const h = (v: unknown) => escapeHtml(v);
const anchorKey = (anchor: Anchor): string => [anchor.sourceId, anchor.sourceRevision, anchor.elementId, anchor.start, anchor.end].join('|');
const sameAnchor = (a: Anchor, b: Anchor): boolean => anchorKey(a) === anchorKey(b);

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

function dataOf(item: RecordItem | undefined): any {
  if(!item)return {};
  if (!item || item.data == null) return null;
  if (typeof item.data === 'string') {
    try { return JSON.parse(item.data); } catch { return null; }
  }
  return item.data;
}

function validAnchor(value: any): value is Anchor {
  return Boolean(value && typeof value === 'object'
    && typeof value.sourceId === 'string' && value.sourceId.length > 0
    && Number.isInteger(value.sourceRevision)
    && typeof value.elementId === 'string'
    && Number.isInteger(value.start) && Number.isInteger(value.end)
    && value.start >= 0 && value.end > value.start
    && typeof value.exact === 'string' && value.exact.length > 0);
}

function targetOf(value: any): Anchor | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return targetOf(JSON.parse(value)); } catch { return null; }
  }
  return validAnchor(value) ? value : null;
}

const RELATION: Record<string, string> = { supports: 'Fundamenta', interprets: 'Interpreta', contrasts: 'Contrasta', illustrates: 'Ilustra' };
const NATURE: Record<string, string> = { original: 'Original', translation: 'Tradução', commentary: 'Comentário', bibliography: 'Bibliografia' };
const PROVENANCE: Record<string, string> = { source: 'Fonte', translation: 'Tradução', interpretation: 'Interpretação', controversy: 'Controvérsia', example: 'Exemplo', reflection: 'Reflexão' };
const RESOURCE_TYPE: Record<string, string> = { explanation: 'Explicação', analogy: 'Analogia', context: 'Contexto', contrast: 'Contraste', interpretation: 'Interpretação', reflection: 'Reflexão', vocabulary: 'Vocabulário' };
const OBSERVATION_STATUS: Record<string, string> = { open: 'Aberta', addressed: 'Tratada', unchanged: 'Sem alteração' };

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
  let noteQuery = '';
  let termQuery = '';
  let editingNoteId: string | null = null;
  let editingTermId: string | null = null;
  let confirmDelete: string | null = null;
  let journalStatus = '';
  const writeOps = new Map<string, string>();
  const inFlightWrites = new Set<string>();
  let editingCommentId: string | null = null;
  let confirmRemoveComment: string | null = null;

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
  const sourceUnits = new Map<string, string>();
  let contextOpen = new Set<string>();
  let uiAnchors = new Map<string, Anchor>();
  let pendingFocus: string | null = null;
  let forceScrollTop = false;

  let clockTimer: number | null = null;
  let lastTick = Date.now();
  let lastSent = 0;
  const accrued = new Map<string,number>();
  let timeRecords:{unitId:string;seconds:number;mode?:TimeMode}[]=[];
  let lastTimeContext='';
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

  function authorLabel(item: any, fallback: string): string {
    if (item && typeof item.origin_profile_id === 'string' && item.origin_profile_id === profileId) return 'Você';
    for (const key of ['author_name', 'authorName', 'display_name', 'displayName', 'name']) {
      const value = item?.[key];
      if (typeof value === 'string' && value.trim() && !UUID_LIKE.test(value.trim())) return value.trim();
    }
    return fallback;
  }

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

  function writeOperation(key: string): string {
    let operationId = writeOps.get(key);
    if (!operationId) { operationId = uid(); writeOps.set(key, operationId); }
    return operationId;
  }

  function contentKey(text: string): string {
    // JSON encoding preserves the full content, so different intents never share
    // an operation id. A 32-bit hash would collide.
    return JSON.stringify(text);
  }

  async function verifyAnchorByPage(anchor: Anchor): Promise<boolean> {
    if(!anchor||!Number.isInteger(anchor.start)||!Number.isInteger(anchor.end)||anchor.start<0||anchor.end<=anchor.start)return false;
    try{const page=await api('source_locate',{sourceId:anchor.sourceId,sourceRevision:anchor.sourceRevision,elementId:anchor.elementId});const block=page.blocks?.find((b:SourceBlock)=>b.id===anchor.elementId);return Boolean(block&&Array.from(block.text).slice(anchor.start,anchor.end).join('')===anchor.exact);}catch{return false;}
  }

  function preparedUnits(tabId?: string): StudyUnit[] {
    const result: StudyUnit[] = [];
    const preferredId = tabId ? sourceUnits.get(tabId) : undefined;
    const preferred = preferredId ? contentCache.get(preferredId) as StudyUnit | undefined : undefined;
    if (preferred && Array.isArray(preferred.references)) result.push(preferred);
    for (const value of contentCache.values()) {
      const unit = value as StudyUnit;
      if (unit && Array.isArray(unit.references) && !result.includes(unit)) result.push(unit);
    }
    return result;
  }

  function editionTargetsFor(tab: ReaderTab): EditionTarget[] {
    const current = tab.anchor;
    if (!current) return [];
    const seen = new Set<string>();
    const targets: EditionTarget[] = [];
    for (const unit of preparedUnits(tab.id)) {
      for (const link of unit.references || []) {
        const inFrom = (link.from || []).some(anchor => sameAnchor(anchor, current));
        const inTo = (link.to || []).some(anchor => sameAnchor(anchor, current));
        if (!inFrom && !inTo) continue;
        const others = inFrom ? (link.to || []) : (link.from || []);
        for (const anchor of others) {
          if (sameAnchor(anchor, current)) continue;
          const key = anchorKey(anchor);
          if (seen.has(key)) continue;
          seen.add(key);
          targets.push({ anchor, relation: link.relation, linkId: link.id });
        }
      }
    }
    return targets;
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

  async function loadRecords(kind: 'note' | 'term' | 'time' | 'state'): Promise<RecordItem[]> {
    recordErrors.delete(kind);
    const items: RecordItem[] = [];
    const seen = new Set<string>();
    let offset = 0;
    for (let pageNumber = 0; pageNumber < MAX_RECORD_PAGES; pageNumber += 1) {
      let result: any;
      try {
        result = await api('reader_records', { projectId, profileId, kind, offset, limit: RECORD_LIMIT });
      } catch (error) {
        recordErrors.set(kind, `${messageOf(error)} (${items.length} registro(s) já lidos)`);
        return items;
      }
      const pageItems: RecordItem[] = Array.isArray(result?.items) ? result.items : [];
      let added = 0;
      for (const item of pageItems) {
        if (!item || typeof item.id !== 'string' || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
        added += 1;
      }
      if(Object.hasOwn(result,'nextOffset')){if(result.nextOffset===null)return items;offset=result.nextOffset;continue;}
      if (pageItems.length < RECORD_LIMIT) return items;
      if (added === 0) {
        recordErrors.set(kind, 'Leitura interrompida: a página não avançou; há registros não carregados.');
        return items;
      }
      offset += pageItems.length;
    }
    recordErrors.set(kind, `Leitura limitada a ${MAX_RECORD_PAGES} páginas de ${RECORD_LIMIT} registros; há registros não carregados.`);
    return items;
  }

  async function loadDiscussionItems(task: 'comment_list' | 'observation_list', key: 'comments' | 'observations'): Promise<any[]> {
    recordErrors.delete(key);
    const items: any[] = [];
    const seen = new Set<string>();
    let offset = 0;
    for (let pageNumber = 0; pageNumber < MAX_RECORD_PAGES; pageNumber += 1) {
      let result: any;
      try {
        result = await api(task, { projectId, offset, limit: RECORD_LIMIT });
      } catch (error) {
        recordErrors.set(key, `${messageOf(error)} (${items.length} registro(s) já lidos)`);
        return items;
      }
      const pageItems: any[] = Array.isArray(result?.items) ? result.items : [];
      let added = 0;
      for (const item of pageItems) {
        if (!item || typeof item.id !== 'string' || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
        added += 1;
      }
      if (pageItems.length < RECORD_LIMIT) return items;
      if (added === 0) {
        recordErrors.set(key, 'Leitura interrompida: a página não avançou; há registros não carregados.');
        return items;
      }
      offset += pageItems.length;
    }
    recordErrors.set(key, `Leitura limitada a ${MAX_RECORD_PAGES} páginas de ${RECORD_LIMIT} registros; há registros não carregados.`);
    return items;
  }

  async function loadComments(): Promise<void> {
    comments = await loadDiscussionItems('comment_list', 'comments');
  }

  async function loadObservations(): Promise<void> {
    observations = await loadDiscussionItems('observation_list', 'observations');
  }

  async function loadState(): Promise<{ id: string; revision: number; data: any } | null> {
    const items = await loadRecords('state');
    const best = [...items].sort((a, b) => (b.revision || 0) - (a.revision || 0))[0];
    if (!best) return null;
    return { id: best.id, revision: best.revision || 0, data: dataOf(best) };
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
      api('bundle_get', { projectId, profileId }).catch((error: unknown) => { personalError = (error as {code?:string})?.code==='NOT_FOUND'?'Seus apoios pessoais ainda estão em preparação.':`Não foi possível abrir os apoios pessoais: ${messageOf(error)}`; return null; }),
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
    const currentAnchor=(anchor:Anchor|null)=>!anchor||sourceIndex.some(s=>s.id===anchor.sourceId&&s.revision===anchor.sourceRevision);
    if (restored) {
      stateRecordId = restored.id;
      stateRevision = restored.revision;
      const data = restored.data;
      const restoredTabs = validTabs(data?.tabs).map(tab=>!currentAnchor(tab.anchor)||!currentAnchor(tab.origin)?{...tab,anchorStatus:'needs_review' as const}:tab);
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
    const markRevision=(item:RecordItem)=>currentAnchor(targetOf(dataOf(item).anchor))?item:{...item,data:{...dataOf(item),anchorStatus:'needs_review'}};
    notes = loadedNotes.map(markRevision);
    terms = loadedTerms.map(markRevision);
    timeRecords=(await loadRecords('time')).map(r=>r.data);
    booted = true;
    void loadAllResources();
    startClock();
  }

  function startClock(): void {
    lastTick = Date.now();
    flushTime(true,'open');
    clockTimer = window.setInterval(() => {
      if (!active) return;
      const now = Date.now();
      const context=currentUnitId+':'+timeMode();
      const delta = context===lastTimeContext&&currentUnitId?foregroundSeconds(lastTick,now,visible&&document.visibilityState==='visible',focused&&document.hasFocus()):0;
      lastTimeContext=context;
      lastTick = now;
      accrued.set(context,(accrued.get(context)||0)+delta);
      if (now-lastSent>=60000) flushTime(false);
    }, 1000);
  }

  function timeMode():TimeMode{return activeTab()?.kind!=='unit'?'exploration':practice&&!practice.finished?'practice':'reading';}
  function flushTime(force: boolean,event='interval'): void {
    if(!currentUnitId)return;
    if(!force&&Date.now()-lastSent<60000)return;
    lastSent = Date.now();
    const samples=[...accrued].map(([key,value])=>{const[unitId,mode]=key.split(':');return {key,unitId,mode,seconds:Math.floor(value)};}).filter(r=>r.seconds>0);
    if(!samples.length&&force)samples.push({key:currentUnitId+':'+timeMode(),unitId:currentUnitId,mode:timeMode(),seconds:0});
    for(const sample of samples){accrued.set(sample.key,(accrued.get(sample.key)||0)-sample.seconds);const {unitId,mode,seconds}=sample;timeRecords.push({unitId,mode:mode as TimeMode,seconds});
      void api('time_record',{operationId:uid(),projectId,profileId,unitId,mode,seconds:Math.min(3600,seconds),event}).catch((error:unknown)=>{saveStatus=`Tempo não confirmado: ${messageOf(error)}`;});
    }
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
    editingCommentId = null;
    confirmRemoveComment = null;
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
    flushTime(true,'unit_change');
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
    replyTo = null;
    editingCommentId = null;
    confirmRemoveComment = null;
    forceScrollTop = true;
    scheduleSave();
    pendingFocus = '#unit-title';
    render();
  }

  async function locateBlock(tabId: string, anchor: Anchor): Promise<void> {
    try{const located=await api('source_locate',{sourceId:anchor.sourceId,sourceRevision:anchor.sourceRevision,elementId:anchor.elementId});const block=located.blocks?.[0];
      if(!block||Array.from(block.text).slice(anchor.start,anchor.end).join('')!==anchor.exact)throw Error('Trecho alterado.');
      sourceOffsets.set(tabId,Math.floor(located.offset/SOURCE_LIMIT)*SOURCE_LIMIT);
    }catch{const tab=tabs.find(t=>t.id===tabId);if(tab)tab.anchorStatus='needs_review';sourceOffsets.set(tabId,0);announce('A passagem precisa de nova conferência. A citação anterior foi preservada.');}
    scheduleSave();if(active)render();
  }

  function openSourceAt(anchor: Anchor, originTabId: string): void {
    const origin = activeTab();
    const inherited = originTabId ? sourceUnits.get(originTabId) : undefined;
    const unitId = inherited || (origin && (origin.kind === 'unit' || origin.kind === 'sources') ? origin.objectId : currentUnitId);
    const meta = sourceEntry(anchor.sourceId, anchor.sourceRevision);
    const tab = openTab('source', anchor.sourceId, meta?.title || 'Fonte', anchor.sourceRevision, { anchor, origin: anchor });
    if (unitId) sourceUnits.set(tab.id, unitId);
    if (originTabId) originLinks.set(tab.id, originTabId);
    sourceOffsets.set(tab.id, 0);
    void locateBlock(tab.id, anchor);
  }

  async function openEdition(anchor: Anchor): Promise<void> {
    const tab = activeTab();
    if (!tab || tab.kind !== 'source') return;
    if (!tab.anchor || tab.anchorStatus === 'needs_review') {
      announce('Âncora atual não verificada; troca por vínculo indisponível. Use a navegação manual de fonte.');
      return;
    }
    announce('Verificando âncoras da edição vinculada…');
    const currentValid = await verifyAnchorByPage(tab.anchor);
    if (!currentValid) {
      announce('A âncora atual não foi verificada na fonte. A troca por vínculo está indisponível; use a navegação manual.');
      return;
    }
    const targetValid = await verifyAnchorByPage(anchor);
    if (!targetValid) {
      announce('O alvo vinculado não foi verificado na própria revisão. A posição não foi transferida; use a navegação manual.');
      return;
    }
    openSourceAt(anchor, tab.id);
    announce('Edição vinculada aberta com revisão e posição próprias.');
  }

  function openManualSource(tab: ReaderTab): void {
    const select = rootEl.querySelector('[data-role="manual-source"]') as HTMLSelectElement | null;
    const value = select?.value || '';
    const separator = value.lastIndexOf('|');
    const sourceId = separator >= 0 ? value.slice(0, separator) : '';
    const revision = Number(separator >= 0 ? value.slice(separator + 1) : '');
    const entry = sourceIndex.find(candidate => candidate.id === sourceId && candidate.revision === revision);
    if (!entry) { announce('Selecione uma fonte do índice para navegar manualmente.'); return; }
    const unitId = sourceUnits.get(tab.id) || currentUnitId;
    const opened = openTab('source', entry.id, entry.title, entry.revision, { anchor: null, origin: tab.anchor || tab.origin || null });
    opened.anchor = null;
    opened.anchorStatus = undefined;
    if (unitId) sourceUnits.set(opened.id, unitId);
    sourceOffsets.set(opened.id, 0);
    forceScrollTop = true;
    scheduleSave();
    render();
    announce('Fonte aberta manualmente na primeira página; nenhuma posição foi transferida.');
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

  function receiptConfirmed(receipt: any, confirmed: string, pending: string): boolean {
    const outcome = outcomeOf(receipt);
    if (outcome.state === 'confirmed') { announce(confirmed); return true; }
    if (outcome.state === 'pending') { saveStatus = pending; announce(pending); return false; }
    throw new Error('Operação sem confirmação.');
  }

  async function guardedWrite(key: string, run: () => Promise<void>): Promise<void> {
    if (inFlightWrites.has(key)) return;
    inFlightWrites.add(key);
    try { await run(); } finally { inFlightWrites.delete(key); }
  }

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
    const key = ['share-note', recordId, String(revision)].join(':');
    const operationId = writeOperation(key);
    journalStatus = '';
    await guardedWrite(key, async () => {
      try {
        const receipt = await api('note_share', { operationId, projectId, profileId, recordId, expectedRevision: revision });
        if (receiptConfirmed(receipt, 'Nota compartilhada como comentário.', 'Compartilhamento salvo neste dispositivo; confirmação remota pendente.')) {
          writeOps.delete(key);
          sharedNotes.add(recordId);
          await loadComments();
          pendingFocus = '[data-action="toggle-section"][data-section="comments"]';
        }
        render();
      } catch (error) {
        discussionFailed(error, key, 'compartilhar a nota', 'Conflito ao compartilhar a nota: ela mudou em outro dispositivo. O rascunho da nota foi preservado; recarregue as notas e os comentários antes de tentar novamente.');
      }
    });
  }

  function writeFailed(error: unknown, key: string, what: string): void {
    const conflict = statusOf(error) === 409;
    if (conflict) writeOps.delete(key);
    const message = conflict
      ? `Conflito ao ${what}: o registro mudou em outro dispositivo. Nada foi sobrescrito; recarregue o caderno antes de editar.`
      : `Não foi possível ${what}: ${messageOf(error)}`;
    journalStatus = message;
    announce(message);
    if (active) render();
  }

  function discussionFailed(error: unknown, key: string, what: string, conflictMessage: string): void {
    const conflict = statusOf(error) === 409;
    if (conflict) writeOps.delete(key);
    const message = conflict ? conflictMessage : `Não foi possível ${what}: ${messageOf(error)}`;
    journalStatus = message;
    announce(message);
    if (active) render();
  }

  async function saveNote(): Promise<void> {
    if (!selAnchor) { announce('Selecione um trecho da fonte antes de salvar a nota.'); return; }
    const saveButton = rootEl.querySelector('[data-action="save-note"]') as HTMLElement | null;
    const text = readField(saveButton || rootEl, 'note-text');
    if (!text) { announce('Escreva a nota antes de salvar.'); return; }
    const key = ['new-note', anchorKey(selAnchor), contentKey(text)].join(':');
    const operationId = writeOperation(key);
    journalStatus = '';
    try {
      const receipt = await api('note_save', { operationId, projectId, profileId, recordId: operationId, expectedRevision: 0, anchor: selAnchor, text });
      writeNotice(receipt, 'Nota privada salva.');
      writeOps.delete(key);
      notes = await loadRecords('note');
      openForm = null;
      pendingFocus = '[data-action="capture-selection"]';
      render();
    } catch (error) { writeFailed(error, key, 'salvar a nota'); }
  }

  async function saveNoteEdit(recordId: string): Promise<void> {
    const item = notes.find(note => note.id === recordId);
    const data = dataOf(item) || {};
    const anchor = targetOf(data.anchor);
    if (!item || !anchor) { announce('Nota sem âncora preservada; edição indisponível.'); return; }
    const saveButton = rootEl.querySelector(`[data-action="save-note-edit"][data-record="${recordId}"]`) as HTMLElement | null;
    const text = readField(saveButton || rootEl, 'edit-note-text');
    if (!text) { announce('Escreva o texto antes de salvar.'); return; }
    const expectedRevision = Number(item.revision) || 0;
    const key = ['edit-note', item.id, String(expectedRevision), contentKey(text)].join(':');
    const operationId = writeOperation(key);
    journalStatus = '';
    try {
      const receipt = await api('note_save', { operationId, projectId, profileId, recordId: item.id, expectedRevision, anchor, text });
      writeNotice(receipt, 'Nota atualizada.');
      writeOps.delete(key);
      editingNoteId = null;
      notes = await loadRecords('note');
      pendingFocus = `[data-action="edit-note"][data-record="${recordId}"]`;
      render();
    } catch (error) { writeFailed(error, key, 'editar a nota'); }
  }

  async function saveTerm(): Promise<void> {
    if (!selAnchor) { announce('Selecione um trecho da fonte antes de salvar o vocabulário.'); return; }
    const scope = (rootEl.querySelector('[data-action="save-term"]') as HTMLElement | null) || rootEl;
    const term = readField(scope, 'term');
    const definition = readField(scope, 'definition');
    if (!term || !definition) { announce('Informe o termo e a definição.'); return; }
    const key = ['new-term', anchorKey(selAnchor), contentKey(JSON.stringify([term,definition]))].join(':');
    const operationId = writeOperation(key);
    journalStatus = '';
    try {
      const receipt = await api('term_save', { operationId, projectId, profileId, recordId: operationId, expectedRevision: 0, anchor: selAnchor, term, definition });
      writeNotice(receipt, 'Vocabulário privado salvo.');
      writeOps.delete(key);
      terms = await loadRecords('term');
      openForm = null;
      pendingFocus = '[data-action="capture-selection"]';
      render();
    } catch (error) { writeFailed(error, key, 'salvar o vocabulário'); }
  }

  async function saveTermEdit(recordId: string): Promise<void> {
    const item = terms.find(entry => entry.id === recordId);
    const data = dataOf(item) || {};
    const anchor = targetOf(data.anchor);
    if (!item || !anchor) { announce('Termo sem âncora preservada; edição indisponível.'); return; }
    const scope = (rootEl.querySelector(`[data-action="save-term-edit"][data-record="${recordId}"]`) as HTMLElement | null) || rootEl;
    const term = readField(scope, 'edit-term');
    const definition = readField(scope, 'edit-definition');
    if (!term || !definition) { announce('Informe o termo e a definição antes de salvar.'); return; }
    const expectedRevision = Number(item.revision) || 0;
    const key = ['edit-term', item.id, String(expectedRevision), contentKey(JSON.stringify([term,definition]))].join(':');
    const operationId = writeOperation(key);
    journalStatus = '';
    try {
      const receipt = await api('term_save', { operationId, projectId, profileId, recordId: item.id, expectedRevision, anchor, term, definition });
      writeNotice(receipt, 'Vocabulário atualizado.');
      writeOps.delete(key);
      editingTermId = null;
      terms = await loadRecords('term');
      pendingFocus = `[data-action="edit-term"][data-record="${recordId}"]`;
      render();
    } catch (error) { writeFailed(error, key, 'editar o vocabulário'); }
  }

  async function deleteRecord(kind: 'note' | 'term', recordId: string): Promise<void> {
    const list = kind === 'note' ? notes : terms;
    const item = list.find(entry => entry.id === recordId);
    if (!item) { announce('Registro indisponível para exclusão.'); return; }
    const expectedRevision = Number(item.revision) || 0;
    const key = ['delete', kind, item.id, String(expectedRevision)].join(':');
    const operationId = writeOperation(key);
    journalStatus = '';
    try {
      const receipt = await api('record_delete', { operationId, projectId, profileId, recordId: item.id, expectedRevision });
      writeNotice(receipt, kind === 'note' ? 'Nota excluída.' : 'Termo excluído.');
      writeOps.delete(key);
      confirmDelete = null;
      if (kind === 'note') { notes = await loadRecords('note'); if (editingNoteId === recordId) editingNoteId = null; }
      else { terms = await loadRecords('term'); if (editingTermId === recordId) editingTermId = null; }
      pendingFocus = kind === 'note' ? '[data-action="toggle-section"][data-section="notes"]' : '[data-action="toggle-section"][data-section="terms"]';
      render();
    } catch (error) { writeFailed(error, key, kind === 'note' ? 'excluir a nota' : 'excluir o vocabulário'); }
  }

  async function saveObservation(): Promise<void> {
    const anchor = selAnchor;
    if (!anchor) { announce('Selecione um trecho da fonte antes de registrar a observação.'); return; }
    const saveButton = rootEl.querySelector('[data-action="save-observation"]') as HTMLElement | null;
    const text = readField(saveButton || rootEl, 'observation-text');
    if (!text) { announce('Escreva a observação antes de registrar.'); return; }
    const key = ['new-observation', anchorKey(anchor), contentKey(text)].join(':');
    const operationId = writeOperation(key);
    journalStatus = '';
    await guardedWrite(key, async () => {
      try {
        const receipt = await api('observation_add', { operationId, projectId, profileId, observationId: operationId, target: anchor, text });
        if (receiptConfirmed(receipt, 'Observação registrada.', 'Observação salva neste dispositivo; confirmação remota pendente.')) {
          writeOps.delete(key);
          await loadObservations();
          openForm = null;
          pendingFocus = '[data-action="capture-selection"]';
        }
        render();
      } catch (error) {
        discussionFailed(error, key, 'registrar a observação', 'Conflito ao registrar a observação: a passagem mudou. O rascunho foi preservado; recarregue as observações antes de tentar novamente.');
      }
    });
  }

  async function saveComment(): Promise<void> {
    const anchor = selAnchor;
    if (!anchor) { announce('Selecione um trecho da fonte antes de comentar.'); return; }
    const saveButton = rootEl.querySelector('[data-action="save-comment"]') as HTMLElement | null;
    const text = readField(saveButton || rootEl, 'comment-text');
    if (!text) { announce('Escreva o comentário antes de enviar.'); return; }
    const key = ['new-comment', anchorKey(anchor), contentKey(text)].join(':');
    const operationId = writeOperation(key);
    journalStatus = '';
    await guardedWrite(key, async () => {
      try {
        const receipt = await api('comment_add', { operationId, projectId, profileId, commentId: operationId, target: anchor, text, replyTo: null });
        if (receiptConfirmed(receipt, 'Comentário enviado.', 'Comentário salvo neste dispositivo; confirmação remota pendente.')) {
          writeOps.delete(key);
          await loadComments();
          openForm = null;
          pendingFocus = '[data-action="capture-selection"]';
        }
        render();
      } catch (error) {
        discussionFailed(error, key, 'enviar o comentário', 'Conflito ao enviar o comentário: a conversa mudou em outro dispositivo. O rascunho foi preservado; recarregue os comentários antes de tentar novamente.');
      }
    });
  }

  async function saveReply(button: HTMLElement): Promise<void> {
    const parentId = button.dataset.comment || '';
    const parent = comments.find(c => c.id === parentId);
    const target = targetOf(parent?.target);
    if (!parent || parent.deleted_at) { announce('Comentário removido não aceita resposta.'); return; }
    if (!target) { announce('Comentário de origem indisponível.'); return; }
    const text = readField(button, `reply-text-${parent.id}`);
    if (!text) { announce('Escreva a resposta antes de enviar.'); return; }
    const key = ['reply-comment', parent.id, anchorKey(target), contentKey(text)].join(':');
    const operationId = writeOperation(key);
    journalStatus = '';
    await guardedWrite(key, async () => {
      try {
        const receipt = await api('comment_add', { operationId, projectId, profileId, commentId: operationId, target, text, replyTo: parent.id });
        if (receiptConfirmed(receipt, 'Resposta enviada.', 'Resposta salva neste dispositivo; confirmação remota pendente.')) {
          writeOps.delete(key);
          await loadComments();
          replyTo = null;
          pendingFocus = `[data-action="reply-comment"][data-comment="${parent.id}"]`;
        }
        render();
      } catch (error) {
        discussionFailed(error, key, 'responder', 'Conflito ao responder: a conversa mudou em outro dispositivo. O rascunho foi preservado; recarregue os comentários antes de tentar novamente.');
      }
    });
  }

  async function saveCommentEdit(button: HTMLElement): Promise<void> {
    const commentId = button.dataset.comment || '';
    const item = comments.find(c => c.id === commentId);
    if (!item || item.deleted_at || item.origin_profile_id !== profileId) { announce('Comentário indisponível para edição.'); return; }
    const text = readField(button, `edit-comment-text-${item.id}`);
    if (!text) { announce('Escreva o texto antes de salvar.'); return; }
    const expectedRevision = Number(item.revision) || 0;
    const key = ['edit-comment', item.id, String(expectedRevision), contentKey(text)].join(':');
    const operationId = writeOperation(key);
    journalStatus = '';
    await guardedWrite(key, async () => {
      try {
        const receipt = await api('comment_edit', { operationId, projectId, commentId: item.id, expectedRevision, text });
        if (receiptConfirmed(receipt, 'Comentário atualizado.', 'Edição salva neste dispositivo; confirmação remota pendente.')) {
          writeOps.delete(key);
          editingCommentId = null;
          await loadComments();
          pendingFocus = `[data-action="edit-comment"][data-comment="${item.id}"]`;
        }
        render();
      } catch (error) {
        discussionFailed(error, key, 'editar o comentário', 'Conflito ao editar o comentário: ele mudou em outro dispositivo. O rascunho foi preservado; recarregue os comentários antes de tentar novamente.');
      }
    });
  }

  async function removeComment(button: HTMLElement): Promise<void> {
    const commentId = button.dataset.comment || '';
    const item = comments.find(c => c.id === commentId);
    if (!item || item.deleted_at || item.origin_profile_id !== profileId) { announce('Comentário indisponível para exclusão.'); return; }
    const expectedRevision = Number(item.revision) || 0;
    const key = ['remove-comment', item.id, String(expectedRevision)].join(':');
    const operationId = writeOperation(key);
    journalStatus = '';
    await guardedWrite(key, async () => {
      try {
        const receipt = await api('comment_remove', { operationId, projectId, commentId: item.id, expectedRevision });
        if (receiptConfirmed(receipt, 'Comentário excluído. As respostas de outras pessoas foram preservadas.', 'Exclusão salva neste dispositivo; confirmação remota pendente.')) {
          writeOps.delete(key);
          confirmRemoveComment = null;
          await loadComments();
          pendingFocus = '[data-action="toggle-section"][data-section="comments"]';
        }
        render();
      } catch (error) {
        discussionFailed(error, key, 'excluir o comentário', 'Conflito ao excluir o comentário: ele mudou em outro dispositivo. Nada foi sobrescrito; recarregue os comentários antes de tentar novamente.');
      }
    });
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
    if (personalError) statuses.push(personalError);
    if (saveStatus) statuses.push(saveStatus);
    if (journalStatus) statuses.push(journalStatus);
    if (recordErrors.get('state')) statuses.push(`Estado não restaurado: ${recordErrors.get('state')}`);
    if (recordErrors.get('comments')) statuses.push(`Comentários indisponíveis: ${recordErrors.get('comments')}`);
    if (recordErrors.get('observations')) statuses.push(`Observações indisponíveis: ${recordErrors.get('observations')}`);

    const originVisible = Boolean(tab && (tab.origin || originLinks.has(tab.id)));
    const inputDrafts=new Map([...rootEl.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input[data-field],textarea[data-field]')].map(el=>[el.dataset.field!,{value:el.value,start:el.selectionStart,end:el.selectionEnd,focused:el===document.activeElement}]));
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
            ${options.onUpdate?iconButton('reset','Conferir e atualizar este estudo','update-study'):''}
          </div>
        </header>
        <div class="reader-status" role="status" aria-live="polite">${h(statuses.join(' · '))}</div>
        ${booted ? renderTabStrip() : ''}
        <main class="reader-main" data-role="main" tabindex="-1">${body}</main>
      </section>`;
    for(const el of rootEl.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input[data-field],textarea[data-field]')){const draft=inputDrafts.get(el.dataset.field!);if(draft&&!tabChanged){el.value=draft.value;if(draft.focused){el.focus({preventScroll:true});if(draft.start!==null&&draft.end!==null)el.setSelectionRange(draft.start,draft.end);}}}

    const actionIcons:Record<string,string>={'open-sources':'book-text','open-resource':'sparkles','practice-start':'play','practice-next':'arrow-right','open-record-source':'reposition','share-note':'upload','reply-comment':'prompt','save-reply':'save','toggle-context':'more','open-source':'book-open','capture-selection':'preview','source-prev':'arrow-left','source-next':'arrow-right','toggle-form':'edit','save-note':'save','save-term':'save','save-observation':'review','save-comment':'prompt','open-edition':'book-open','open-manual-source':'book-text','edit-note':'edit','edit-term':'edit','save-note-edit':'save','save-term-edit':'save','cancel-edit':'remove-state','ask-delete':'remove-state','confirm-delete':'remove-state','cancel-delete':'remove-state'};
    for(const button of rootEl.querySelectorAll<HTMLButtonElement>('button.control')){const label=button.textContent?.trim()||'Abrir';button.setAttribute('aria-label',label);button.title=label;button.classList.remove('control');button.classList.add('icon-button');button.innerHTML=renderUiIcon(actionIcons[button.dataset.action||'']||'more');}
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
    return `<details class="tab-list" ${lastTabRendered===activeTabId&&rootEl.querySelector<HTMLDetailsElement>('.tab-list')?.open?'open':''}><summary>${h(activeTab()?.title||'Abas abertas')} <span class="muted">· ${tabs.length} abas</span></summary><nav class="tabstrip" role="tablist" aria-label="Abas abertas">
      ${tabs.map(tab => `<span class="tab" data-active="${tab.id === activeTabId}">
        <button type="button" class="tab-activate" role="tab" aria-selected="${tab.id === activeTabId}" data-action="switch-tab" data-tab="${h(tab.id)}" title="${h(tab.title)}">${h(tab.title)}</button>
        ${iconButton('remove-state', 'Fechar aba', 'close-tab', `data-tab="${h(tab.id)}"`)}
      </span>`).join('')}
    </nav></details>`;
  }

  function renderUnit(tab: ReaderTab): string {
    const unit = contentCache.get(tab.objectId) as StudyUnit | undefined;
    if (!unit) {
      ensureContent(tab.objectId);
      if (contentErrors.get(tab.objectId)) return `<section class="reader-card" role="alert"><h2>Unidade indisponível</h2><p>${h(contentErrors.get(tab.objectId))}</p></section>`;
      return `<div class="reader-loading" role="status">Carregando unidade…</div>`;
    }
    const groups = groupsFor(unit);
    const estimate=remainingMinutes(units.map(u=>u.id),unit.id,timeRecords);
    return `
      <section class="reader-card unit-card" aria-labelledby="unit-title">
        <div class="unit-toolbar">
          <label class="field-label" for="unit-select">Unidade</label>
          <select id="unit-select" class="field-select" data-role="unit-select" aria-label="Trocar unidade">
            ${units.map(entry => `<option value="${h(entry.id)}" ${entry.id === unit.id ? 'selected' : ''}>${h(entry.title)}</option>`).join('')}
          </select>
        </div>
        <h2 id="unit-title" tabindex="-1">${h(unit.title)}</h2>
        <p class="muted">${estimate?`Cerca de ${estimate} min de leitura principal restante, pelo ritmo observado.`:'Estimativa de leitura disponível após percorrer uma unidade.'} Prática e exploração são registradas separadamente; tempo não mede aprendizagem.</p>
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

  function quotePreview(text?:string):string{if(!text)return '<p class="muted">Trecho indisponível</p>';const points=Array.from(text);return points.length<=180?`<p class="quote" dir="auto">${h(text)}</p>`:`<details class="quote-preview"><summary>${h(points.slice(0,180).join(''))}…</summary><p class="quote" dir="auto">${h(text)}</p></details>`;}

  function journalMatches(query: string, values: (string | undefined)[]): boolean {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return true;
    return values.some(value => String(value ?? '').toLocaleLowerCase().includes(needle));
  }

  function renderJournalSearch(kind: 'note' | 'term', query: string, shown: number, total: number): string {
    const id = kind === 'note' ? 'note-search' : 'term-search';
    const label = kind === 'note' ? 'Buscar nas notas' : 'Buscar no vocabulário';
    return `<div class="journal-tools">
      <label class="field-label" for="${id}">${label} (${shown} de ${total})</label>
      <input id="${id}" class="field-input" type="search" data-role="${id}" data-field="${id}" value="${h(query)}" autocomplete="off" placeholder="Texto, termo ou trecho">
    </div>`;
  }

  function renderNotesSection(): string {
    const filtered = notes.filter(item => {
      const data = dataOf(item) || {};
      const anchor = targetOf(data.anchor);
      return journalMatches(noteQuery, [data.text, anchor?.exact, anchor?.locator]);
    });
    const records = filtered.map(item => {
      const data = dataOf(item) || {};
      const anchor = targetOf(data.anchor);
      const review = data.anchorStatus === 'needs_review';
      const editing = editingNoteId === item.id;
      const deleting = confirmDelete === `note:${item.id}`;
      const body = editing
        ? `<div class="edit-form" data-form-block>
            <label class="field-label" for="edit-note-${h(item.id)}">Texto da nota</label>
            <textarea id="edit-note-${h(item.id)}" class="field-input" data-field="edit-note-text" rows="4">${h(data.text || '')}</textarea>
            <div class="button-row">
              <button type="button" class="control" data-action="save-note-edit" data-record="${h(item.id)}">Salvar alterações</button>
              <button type="button" class="control" data-action="cancel-edit" data-kind="note">Cancelar</button>
            </div>
          </div>`
        : `<p class="record-text" dir="auto">${h(data.text || '')}</p>`;
      const actions = deleting
        ? `<div class="warning" role="alert">
            <p>Confirmar exclusão desta nota? A âncora e o texto serão removidos.</p>
            <div class="button-row">
              <button type="button" class="control" data-action="confirm-delete" data-kind="note" data-record="${h(item.id)}">Excluir definitivamente</button>
              <button type="button" class="control" data-action="cancel-delete" data-kind="note">Cancelar</button>
            </div>
          </div>`
        : `<div class="button-row">
            ${anchor ? `<button type="button" class="control" data-action="open-record-source" data-anchor="${anchorRef(anchor)}">Ver no contexto</button>` : ''}
            <button type="button" class="control" data-action="edit-note" data-record="${h(item.id)}">Editar</button>
            <button type="button" class="control" data-action="ask-delete" data-kind="note" data-record="${h(item.id)}">Excluir</button>
            <button type="button" class="control" data-action="share-note" data-record="${h(item.id)}" data-revision="${Number(item.revision) || 0}" ${sharedNotes.has(item.id) ? 'disabled' : ''}>${sharedNotes.has(item.id) ? 'Compartilhada' : 'Compartilhar como comentário'}</button>
          </div>`;
      return `<article class="record-card">
        ${quotePreview(anchor?.exact)}
        ${review ? `<p class="warning">Revisão pendente. Trecho anterior preservado: “${h(anchor?.exact || '')}”.</p>` : ''}
        <p class="meta-line">Revisão do registro: ${Number(item.revision) || 0}${anchor ? ` · ${h(anchor.locator||"Passagem selecionada")}` : ''}</p>
        ${body}
        ${actions}
      </article>`;
    }).join('');
    let content = renderJournalSearch('note', noteQuery, filtered.length, notes.length);
    if (!notes.length) content += `<p class="muted">${recordErrors.get('note') ? `Notas indisponíveis: ${h(recordErrors.get('note'))}` : 'Nenhuma nota privada.'}</p>`;
    else if (!filtered.length) content += `<p class="muted">Nenhuma nota encontrada.</p>`;
    else content += records;
    if (recordErrors.get('note') && notes.length) content += `<p class="warning">Leitura parcial: ${h(recordErrors.get('note'))}</p>`;
    return sectionWrap('notes', 'Notas privadas', notes.length, content);
  }

  function renderTermsSection(): string {
    const filtered = terms.filter(item => {
      const data = dataOf(item) || {};
      const anchor = targetOf(data.anchor);
      return journalMatches(termQuery, [data.term, data.definition, anchor?.exact]);
    });
    const records = filtered.map(item => {
      const data = dataOf(item) || {};
      const anchor = targetOf(data.anchor);
      const review = data.anchorStatus === 'needs_review';
      const editing = editingTermId === item.id;
      const deleting = confirmDelete === `term:${item.id}`;
      const body = editing
        ? `<div class="edit-form" data-form-block>
            <label class="field-label" for="edit-term-${h(item.id)}">Termo</label>
            <input id="edit-term-${h(item.id)}" class="field-input" data-field="edit-term" value="${h(data.term || '')}">
            <label class="field-label" for="edit-definition-${h(item.id)}">Definição</label>
            <textarea id="edit-definition-${h(item.id)}" class="field-input" data-field="edit-definition" rows="4">${h(data.definition || '')}</textarea>
            <div class="button-row">
              <button type="button" class="control" data-action="save-term-edit" data-record="${h(item.id)}">Salvar alterações</button>
              <button type="button" class="control" data-action="cancel-edit" data-kind="term">Cancelar</button>
            </div>
          </div>`
        : `<p class="record-text" dir="auto">${h(data.definition || '')}</p>`;
      const actions = deleting
        ? `<div class="warning" role="alert">
            <p>Confirmar exclusão deste termo? A âncora e a definição serão removidas.</p>
            <div class="button-row">
              <button type="button" class="control" data-action="confirm-delete" data-kind="term" data-record="${h(item.id)}">Excluir definitivamente</button>
              <button type="button" class="control" data-action="cancel-delete" data-kind="term">Cancelar</button>
            </div>
          </div>`
        : `<div class="button-row">
            ${anchor ? `<button type="button" class="control" data-action="open-record-source" data-anchor="${anchorRef(anchor)}">Ver no contexto</button>` : ''}
            <button type="button" class="control" data-action="edit-term" data-record="${h(item.id)}">Editar</button>
            <button type="button" class="control" data-action="ask-delete" data-kind="term" data-record="${h(item.id)}">Excluir</button>
          </div>`;
      return `<article class="record-card">
        <div class="record-head"><h3>${h(data.term || '')}</h3>${review ? '<span class="badge">Revisão pendente</span>' : ''}</div>
        <p class="quote">${h(anchor?.exact || 'Trecho indisponível')}</p>
        ${review ? `<p class="warning">Trecho anterior preservado: “${h(anchor?.exact || '')}”.</p>` : ''}
        <p class="meta-line">Revisão do registro: ${Number(item.revision) || 0}${anchor ? ` · bloco ${h(anchor.elementId)} · posições ${anchor.start}–${anchor.end}` : ''}</p>
        ${body}
        ${actions}
      </article>`;
    }).join('');
    let content = renderJournalSearch('term', termQuery, filtered.length, terms.length);
    if (!terms.length) content += `<p class="muted">${recordErrors.get('term') ? `Vocabulário indisponível: ${h(recordErrors.get('term'))}` : 'Nenhum termo salvo.'}</p>`;
    else if (!filtered.length) content += `<p class="muted">Nenhum termo encontrado.</p>`;
    else content += records;
    if (recordErrors.get('term') && terms.length) content += `<p class="warning">Leitura parcial: ${h(recordErrors.get('term'))}</p>`;
    return sectionWrap('terms', 'Vocabulário', terms.length, content);
  }

  function renderObservationsSection(): string {
    const groups = new Map<string, ObservationGroup>();
    for (const item of observations) {
      const target = targetOf(item?.target);
      const key = target ? anchorKey(target) : 'sem-alvo';
      let group = groups.get(key);
      if (!group) { group = { target, items: [] }; groups.set(key, group); }
      group.items.push(item);
    }
    const reload = `<div class="button-row">${iconButton('rotate', 'Recarregar observações', 'reload-observations')}</div>`;
    const content = groups.size ? [...groups.values()].map(group => {
      const observationsHtml = group.items.map(item => {
        const author = authorLabel(item, 'Participante');
        const status = OBSERVATION_STATUS[item.status] || item.status || 'Estado não informado';
        return `<article class="observation-item">
          <div class="record-head"><h4>${h(author)}</h4><span class="badge">${h(status)}</span></div>
          <p class="record-text" dir="auto">${h(item.text || '')}</p>
          ${item.result ? `<p class="muted">Resultado: ${h(item.result)}</p>` : '<p class="muted">Sem resultado registrado.</p>'}
        </article>`;
      }).join('');
      const target = group.target;
      return `<article class="observation-group">
        <div class="record-head"><h3>${target ? 'Passagem' : 'Sem alvo declarado'}</h3><span class="badge">${group.items.length} observação(ões)</span></div>
        ${target ? `<p class="quote" dir="auto">${h(target.exact)}</p>
          <p class="meta-line">${h(metaFor(target.sourceId,target.sourceRevision).title)} · ${h(target.locator||"Passagem selecionada")}</p>
          <div class="button-row">${iconButton('reposition', 'Ver no contexto', 'open-record-source', `data-anchor="${anchorRef(target)}"`)}</div>` : '<p class="muted">O registro não declara alvo; não foi agrupado por similaridade.</p>'}
        ${observationsHtml}
      </article>`;
    }).join('') : `<p class="muted">${recordErrors.get('observations') ? `Observações indisponíveis: ${h(recordErrors.get('observations'))}` : 'Nenhuma observação registrada.'}</p>`;
    const warning = recordErrors.get('observations') && observations.length ? `<p class="warning">Leitura parcial: ${h(recordErrors.get('observations'))}</p>` : '';
    return sectionWrap('observations', 'Observações', observations.length, `<p class="muted">${observations.length} observações em ${groups.size} passagens.</p>${reload}${content}${warning}`);
  }

  function renderCommentsSection(): string {
    const byId = new Map<string, any>();
    const ordered: any[] = [];
    for (const comment of comments) {
      if (!comment || typeof comment.id !== 'string' || byId.has(comment.id)) continue;
      byId.set(comment.id, comment);
      ordered.push(comment);
    }
    const parentOf = new Map<string, string>();
    for (const comment of ordered) {
      const parentId = typeof comment.reply_to === 'string' ? comment.reply_to : '';
      if (parentId && parentId !== comment.id && byId.has(parentId)) parentOf.set(comment.id, parentId);
    }
    for (const comment of ordered) {
      const seen = new Set<string>([comment.id]);
      let parentId = parentOf.get(comment.id);
      while (parentId) {
        if (seen.has(parentId)) { parentOf.delete(comment.id); break; }
        seen.add(parentId);
        parentId = parentOf.get(parentId);
      }
    }
    const children = new Map<string, any[]>();
    for (const comment of ordered) {
      const parentId = parentOf.get(comment.id);
      if (!parentId) continue;
      const list = children.get(parentId) || [];
      list.push(comment);
      children.set(parentId, list);
    }
    const roots = ordered.filter(comment => !parentOf.has(comment.id));

    const renderOne = (comment: any, depth: number): string => {
      const target = targetOf(comment.target);
      const deleted = Boolean(comment.deleted_at);
      const mine = comment.origin_profile_id === profileId;
      const author = deleted ? 'Comentário removido' : authorLabel(comment, 'Participante');
      const editing = !deleted && mine && editingCommentId === comment.id;
      const removing = !deleted && mine && confirmRemoveComment === comment.id;
      const actions: string[] = [];
      if (!deleted) {
        if (mine) actions.push(iconButton('edit', 'Editar comentário', 'edit-comment', `data-comment="${h(comment.id)}"`));
        if (mine) actions.push(iconButton('trash', 'Excluir comentário', 'ask-delete-comment', `data-comment="${h(comment.id)}"`));
        actions.push(iconButton('prompt', 'Responder comentário', 'reply-comment', `data-comment="${h(comment.id)}" aria-expanded="${replyTo === comment.id}"`));
      }
      const body = editing
        ? `<div class="edit-form" data-form-block>
            <label class="field-label" for="edit-comment-${h(comment.id)}">Editar comentário</label>
            <textarea id="edit-comment-${h(comment.id)}" class="field-input" data-field="edit-comment-text-${h(comment.id)}" rows="3">${h(comment.text || '')}</textarea>
            <div class="button-row">
              ${iconButton('save', 'Salvar comentário', 'save-comment-edit', `data-comment="${h(comment.id)}"`)}
              ${iconButton('remove-state', 'Cancelar edição', 'cancel-comment-edit', `data-comment="${h(comment.id)}"`)}
            </div>
          </div>`
        : `<p class="record-text" dir="auto">${h(deleted ? 'Conteúdo removido pelo titular. As respostas de outras pessoas foram preservadas.' : comment.text || '')}</p>`;
      const removeBox = removing
        ? `<div class="warning" role="alert">
            <p>Excluir este comentário? O texto será removido; as respostas de outras pessoas serão preservadas.</p>
            <div class="button-row">
              ${iconButton('trash', 'Confirmar exclusão do comentário', 'confirm-delete-comment', `data-comment="${h(comment.id)}"`)}
              ${iconButton('remove-state', 'Cancelar exclusão', 'cancel-delete-comment', `data-comment="${h(comment.id)}"`)}
            </div>
          </div>` : '';
      const replyForm = replyTo === comment.id && !deleted
        ? `<div class="reply-form" data-form-block>
            <label class="field-label" for="reply-text-${h(comment.id)}">Resposta a ${h(author)}</label>
            <textarea id="reply-text-${h(comment.id)}" class="field-input" data-field="reply-text-${h(comment.id)}" rows="3"></textarea>
            <div class="button-row">${iconButton('save', 'Enviar resposta', 'save-reply', `data-comment="${h(comment.id)}"`)}</div>
          </div>` : '';
      const depthStyle = depth ? ` style="--comment-depth:${Math.min(depth, 4)}"` : '';
      return `<article class="comment ${depth ? 'comment-reply' : ''}${deleted ? ' comment-tombstone' : ''}"${depthStyle} data-comment-id="${h(comment.id)}">
        <div class="record-head"><h3>${h(author)}</h3>${target?.exact ? '<span class="badge">Passagem</span>' : ''}</div>
        ${target?.exact ? `<p class="quote" dir="auto">${h(target.exact)}</p>` : ''}
        ${body}
        ${removeBox}
        ${actions.length ? `<div class="button-row">${actions.join('')}</div>` : ''}
        ${replyForm}
      </article>`;
    };

    const html: string[] = [];
    const visited = new Set<string>();
    const stack: { item: any; depth: number }[] = [];
    for (let i = roots.length - 1; i >= 0; i -= 1) stack.push({ item: roots[i], depth: 0 });
    while (stack.length) {
      const current = stack.pop()!;
      if (visited.has(current.item.id)) continue;
      visited.add(current.item.id);
      html.push(renderOne(current.item, current.depth));
      const kids = children.get(current.item.id) || [];
      for (let i = kids.length - 1; i >= 0; i -= 1) stack.push({ item: kids[i], depth: current.depth + 1 });
    }
    for (const comment of ordered) {
      if (!visited.has(comment.id)) html.push(renderOne(comment, 0));
    }

    const reload = `<div class="button-row">${iconButton('rotate', 'Recarregar comentários', 'reload-comments')}</div>`;
    const list = html.length
      ? html.join('')
      : `<p class="muted">${recordErrors.get('comments') ? `Comentários indisponíveis: ${h(recordErrors.get('comments'))}` : 'Nenhum comentário.'}</p>`;
    const warning = recordErrors.get('comments') && comments.length ? `<p class="warning">Leitura parcial: ${h(recordErrors.get('comments'))}</p>` : '';
    return sectionWrap('comments', 'Comentários', comments.length, `<p class="muted">${comments.length} comentário(s) em ${roots.length} conversa(s).</p>${reload}${list}${warning}`);
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

  function renderEditionsSection(tab: ReaderTab): string {
    const unitId = sourceUnits.get(tab.id) || currentUnitId;
    if (unitId && !contentCache.has(unitId) && !contentErrors.has(unitId)) ensureContent(unitId);
    const hasAnchor = Boolean(tab.anchor);
    const targets = hasAnchor && tab.anchorStatus !== 'needs_review' ? editionTargetsFor(tab) : [];
    const targetList = targets.length
      ? targets.map(target => {
          const meta = metaFor(target.anchor.sourceId, target.anchor.sourceRevision);
          return `<article class="edition-target">
            <div class="record-head"><h3>${h(meta.title)}</h3><span class="badge">${h(RELATION[target.relation] || target.relation)}</span></div>
            <p class="meta-line">${h(target.anchor.locator||"Passagem correspondente")}</p>
            <p class="quote" dir="auto">${h(target.anchor.exact)}</p>
            <button type="button" class="control" data-action="open-edition" data-anchor="${anchorRef(target.anchor)}">Abrir edição vinculada</button>
          </article>`;
        }).join('')
      : `<p class="muted">${hasAnchor ? 'Não há correspondência preparada com outra edição para esta passagem.' : 'Sem âncora verificada nesta fonte. A troca por vínculo está indisponível.'}</p>`;
    const manualOptions = sourceIndex.map(entry => `<option value="${h(entry.id)}|${entry.revision}" ${(entry.id === tab.objectId && entry.revision === tab.revision) ? 'selected' : ''}>${h(entry.title)} · revisão ${entry.revision}</option>`).join('');
    const manual = manualOptions
      ? `<div class="manual-source">
          <label class="field-label" for="manual-source">Navegar outra fonte manualmente</label>
          <select id="manual-source" class="field-select" data-role="manual-source">${manualOptions}</select>
          <button type="button" class="control" data-action="open-manual-source" data-tab="${h(tab.id)}">Abrir fonte manualmente</button>
          <p class="muted">A navegação manual abre a fonte na primeira página; nenhuma posição ou âncora é transferida.</p>
        </div>`
      : '<p class="muted">Nenhuma outra fonte identificada no índice.</p>';
    return `<details class="edition-panel"><summary>Outras edições · ${targets.length} correspondências</summary>
      ${targetList}
      ${manual}
    </details>`;
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
      if (!review&&hit&&hit.sourceId===tab.objectId&&hit.sourceRevision===tab.revision&&hit.elementId===block.id&&Array.from(block.text).slice(hit.start,hit.end).join('')===hit.exact) {
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
      ${renderEditionsSection(tab)}
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
    if (openForm === 'observation') form = formBlock('Observação', `<label class="field-label" for="observation-text">Observação</label><textarea id="observation-text" class="field-input" data-field="observation-text" rows="4"></textarea><div class="button-row">${iconButton('review', 'Registrar observação', 'save-observation')}</div>`);
    if (openForm === 'comment') form = formBlock('Comentário', `<label class="field-label" for="comment-text">Comentário</label><textarea id="comment-text" class="field-input" data-field="comment-text" rows="4"></textarea><div class="button-row">${iconButton('prompt', 'Enviar comentário', 'save-comment')}</div>`);
    return `<section class="selection-panel" aria-labelledby="selection-title">
      <div class="section-head"><h3 id="selection-title">Seleção</h3><span class="badge">${Array.from(selAnchor.exact).length} caractere(s)</span></div>
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
      case 'update-study':
        if(!options.onUpdate)return;
        if(saving)throw new Error('Aguarde a confirmação das abas antes de atualizar.');
        if(saveTimer!==null){clearTimeout(saveTimer);saveTimer=null;}queuedSave=false;
        await saveNow();if(saveStatus)throw new Error(saveStatus);
        booted=false;
        try{await options.onUpdate();}catch(error){booted=true;throw error;}
        return;
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
        const comment = comments.find(c => c.id === id);
        if (!comment || comment.deleted_at) { announce('Comentário removido não aceita resposta.'); return; }
        replyTo = replyTo === id ? null : id;
        pendingFocus = replyTo ? `[data-field="reply-text-${id}"]` : `[data-action="reply-comment"][data-comment="${id}"]`;
        render();
        return;
      }
      case 'save-reply': await saveReply(button); return;
      case 'reload-comments':
        await loadComments();
        pendingFocus = '[data-action="reload-comments"]';
        render();
        return;
      case 'reload-observations':
        await loadObservations();
        pendingFocus = '[data-action="reload-observations"]';
        render();
        return;
      case 'edit-comment': {
        const id = button.dataset.comment || '';
        const comment = comments.find(c => c.id === id);
        if (!comment || comment.deleted_at || comment.origin_profile_id !== profileId) { announce('Comentário indisponível para edição.'); return; }
        editingCommentId = id;
        confirmRemoveComment = null;
        pendingFocus = `[data-field="edit-comment-text-${id}"]`;
        render();
        return;
      }
      case 'cancel-comment-edit': {
        const id = button.dataset.comment || '';
        editingCommentId = null;
        pendingFocus = `[data-action="edit-comment"][data-comment="${id}"]`;
        render();
        return;
      }
      case 'save-comment-edit': await saveCommentEdit(button); return;
      case 'ask-delete-comment': {
        const id = button.dataset.comment || '';
        const comment = comments.find(c => c.id === id);
        if (!comment || comment.deleted_at || comment.origin_profile_id !== profileId) { announce('Comentário indisponível para exclusão.'); return; }
        confirmRemoveComment = id;
        editingCommentId = null;
        pendingFocus = `[data-action="confirm-delete-comment"][data-comment="${id}"]`;
        render();
        return;
      }
      case 'cancel-delete-comment': {
        const id = button.dataset.comment || '';
        confirmRemoveComment = null;
        pendingFocus = `[data-action="ask-delete-comment"][data-comment="${id}"]`;
        render();
        return;
      }
      case 'confirm-delete-comment': await removeComment(button); return;
      case 'open-edition': {
        const anchor = uiAnchors.get(button.dataset.anchor || '');
        if (!anchor) { announce('Alvo de edição indisponível.'); return; }
        await openEdition(anchor); return;
      }
      case 'open-manual-source': {
        const tab = activeTab();
        if (!tab || tab.kind !== 'source') return;
        openManualSource(tab); return;
      }
      case 'edit-note': {
        editingNoteId = button.dataset.record || null;
        editingTermId = null;
        confirmDelete = null;
        pendingFocus = '[data-field="edit-note-text"]';
        render(); return;
      }
      case 'edit-term': {
        editingTermId = button.dataset.record || null;
        editingNoteId = null;
        confirmDelete = null;
        pendingFocus = '[data-field="edit-term"]';
        render(); return;
      }
      case 'cancel-edit': {
        if (button.dataset.kind === 'note') editingNoteId = null; else editingTermId = null;
        pendingFocus = button.dataset.kind === 'note'
          ? '[data-action="toggle-section"][data-section="notes"]'
          : '[data-action="toggle-section"][data-section="terms"]';
        render(); return;
      }
      case 'ask-delete': {
        const kind = button.dataset.kind === 'term' ? 'term' : 'note';
        const recordId = button.dataset.record || '';
        confirmDelete = `${kind}:${recordId}`;
        editingNoteId = null;
        editingTermId = null;
        pendingFocus = `[data-action="confirm-delete"][data-kind="${kind}"][data-record="${recordId}"]`;
        render(); return;
      }
      case 'cancel-delete': {
        confirmDelete = null;
        pendingFocus = `[data-action="toggle-section"][data-section="${button.dataset.kind === 'term' ? 'terms' : 'notes'}"]`;
        render(); return;
      }
      case 'confirm-delete': {
        const kind = button.dataset.kind === 'term' ? 'term' : 'note';
        await deleteRecord(kind, button.dataset.record || ''); return;
      }
      case 'save-note-edit': await saveNoteEdit(button.dataset.record || ''); return;
      case 'save-term-edit': await saveTermEdit(button.dataset.record || ''); return;
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

  rootEl.addEventListener('input', event => {
    const target = event.target as HTMLInputElement | null;
    if (target?.matches('[data-role="note-search"]')) { noteQuery = target.value; render(); }
    else if (target?.matches('[data-role="term-search"]')) { termQuery = target.value; render(); }
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
    flushTime(true,visible?'resume':'pause');if(!visible)void saveNow();
    lastTick = Date.now();
  }, { signal });
  window.addEventListener('focus', () => { focused = true; lastTick = Date.now(); }, { signal });
  window.addEventListener('blur', () => { focused = false; lastTick = Date.now();flushTime(true,'pause'); }, { signal });
  for(const event of ['pagehide','um-flush'])window.addEventListener(event,()=>{flushTime(true,'pause');void saveNow();},{signal});

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
    flushTime(true,'close');
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
