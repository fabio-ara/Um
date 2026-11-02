import './profile-view.css';
import {renderUiIcon} from './icons.js';
import type {Profile} from '../contracts.ts';
import {announce,escapeHtml as esc,iconButton} from './dom.ts';

export interface ProfileViewOptions {
  accountId: string;
  api: (task: string, args: Record<string, unknown>) => Promise<any>;
  onInvalidated: (profileId: string) => Promise<void>;
}

const PAGE_SIZE = 50;
const MAX_PAGES = 1000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  nome: 'Nome',
  displayName: 'Nome exibido',
  display_name: 'Nome exibido',
  apelido: 'Apelido',
  nickname: 'Apelido',
  description: 'Descrição',
  descricao: 'Descrição',
  bio: 'Sobre',
  title: 'Título',
  titulo: 'Título',
  pronouns: 'Pronomes',
  language: 'Idioma',
};

let mountSequence = 0;

type JsonObject = Record<string, any>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function nickname(profile: Profile): string {
  const fields = profile.fields || {};
  return fields.name || fields.nome || fields.apelido || fields.displayName || fields.display_name || fields.nickname || 'Perfil sem apelido';
}

function descriptionOf(profile: Profile): string {
  const fields = profile.fields || {};
  return String(fields.description || fields.descricao || fields.bio || '').trim();
}

function messageOf(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : 'Não foi possível concluir a ação.';
  return message.replace(UUID, 'identificador');
}

function normalizeProfile(raw: unknown): Profile | null {
  if (!isObject(raw) || typeof raw.id !== 'string') return null;
  const creatorId = raw.creatorId ?? raw.creator_id;
  const holderId = raw.holderId ?? raw.holder_id ?? null;
  if (typeof creatorId !== 'string') return null;
  const fields: Record<string, string> = {};
  if (isObject(raw.fields)) {
    for (const [key, value] of Object.entries(raw.fields)) {
      if (typeof value === 'string') fields[key] = value;
    }
  }
  return {
    id: raw.id,
    creatorId,
    holderId: typeof holderId === 'string' ? holderId : null,
    creatorAccess: raw.creatorAccess ?? raw.creator_access ?? true,
    visibility: raw.visibility === 'public' ? 'public' : 'private',
    fields,
    revision: typeof raw.revision === 'number' ? raw.revision : 0,
  };
}

function receiptConfirmed(value: unknown, operationId: string): boolean {
  return isObject(value)&&value.status==='confirmed'&&value.operationId===operationId;
}

function receiptResult(value: unknown): JsonObject {
  if (isObject(value) && value.status === 'confirmed' && isObject(value.result)) return value.result;
  return isObject(value) ? value : {};
}

function freshOperationId(): string {
  return crypto.randomUUID();
}

export async function mountProfiles(root: HTMLElement, options: ProfileViewOptions): Promise<() => void> {
  const mutate=async(task:string,args:Record<string,unknown>):Promise<any>=>{
    try{return await options.api(task,args);}catch(error){
      try{const receipt=await options.api('operation_get',{operationId:args.operationId});if(receiptConfirmed(receipt,String(args.operationId))&&receipt.result?.profileId===args.profileId)return receipt;}catch{/* Keep original failure and stable intent. */}
      throw error;
    }
  };
  const accountId = options.accountId;
  const controller = new AbortController();
  const view = document.createElement('section');
  const headingId = `profile-view-title-${++mountSequence}`;
  view.className = 'profile-view';
  view.setAttribute('aria-labelledby', headingId);
  root.appendChild(view);

  let disposed = false;
  let loaded = false;
  let loadError = '';
  let statusMessage = '';
  let busy: string | null = null;
  let editRef: string | null = null;
  let deleteRef: string | null = null;
  let exportRef: string | null = null;
  let refSequence = 0;
  let profiles: Profile[] = [];
  const refs = new Map<string, string>();
  const byRef = new Map<string, Profile>();
  const drafts = new Map<string, Record<string, string>>();
  const exportJson = new Map<string, string>();
  const exportErrors = new Map<string, string>();
  const cardErrors = new Map<string, string>();
  const operationIds = new Map<string, string>();

  const refFor = (profileId: string): string => {
    let ref = refs.get(profileId);
    if (!ref) {
      ref = `p${++refSequence}`;
      refs.set(profileId, ref);
    }
    return ref;
  };

  const operationId = (kind: string, profileId: string, intent: string): string => {
    const key = `${kind}:${profileId}:${intent}`;
    let id = operationIds.get(key);
    if (!id) {
      id = freshOperationId();
      operationIds.set(key, id);
    }
    return id;
  };

  const setStatus = (message: string) => {
    statusMessage = message;
    const status = view.querySelector<HTMLElement>('[data-status]');
    if (status) status.textContent = message;
    if (message) announce(message);
  };

  const beginBusy = (key: string, button?: HTMLButtonElement): boolean => {
    if (busy) return false;
    busy = key;
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    return true;
  };

  const finishBusy = (button?: HTMLButtonElement) => {
    busy = null;
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  };

  const focusAction = (action: string, ref?: string) => {
    const selector = ref
      ? `button[data-action="${action}"][data-profile="${ref}"]`
      : `button[data-action="${action}"]`;
    view.querySelector<HTMLButtonElement>(selector)?.focus();
  };

  const showCardError = (profileId: string, message: string) => {
    const ref = refs.get(profileId);
    if (!ref || disposed) return;
    const card = view.querySelector<HTMLElement>(`[data-card="${ref}"]`);
    if (!card) return;
    let element = card.querySelector<HTMLElement>('[data-card-error]');
    if (!element) {
      element = document.createElement('p');
      element.className = 'profile-error';
      element.setAttribute('role', 'alert');
      element.dataset.cardError = '';
      const form = card.querySelector('.profile-form');
      card.insertBefore(element, form || null);
    }
    element.textContent = message;
  };

  const clearCardError = (profileId: string) => {
    const ref = refs.get(profileId);
    if (!ref) return;
    view.querySelector(`[data-card="${ref}"] [data-card-error]`)?.remove();
  };

  const invalidate = async (profileId: string): Promise<boolean> => {
    try {
      await options.onInvalidated(profileId);
      return true;
    } catch {
      return false;
    }
  };

  const isCreator = (profile: Profile) => profile.creatorId === accountId;
  const isHolder = (profile: Profile) => profile.holderId === accountId;
  const canEdit = (profile: Profile) => isHolder(profile) || (isCreator(profile) && profile.creatorAccess);
  const canExport = (profile: Profile) => isHolder(profile) || (isCreator(profile) && profile.holderId === null);
  const canManage = (profile: Profile) => isHolder(profile) || (isCreator(profile) && profile.holderId===null);
  const canRevokeCreator = (profile: Profile) => isHolder(profile) && profile.creatorId !== accountId && profile.creatorAccess !== false;
  const canMakePrivate = (profile: Profile) => canManage(profile) && profile.visibility === 'public';
  const canDelete = (profile: Profile) => canManage(profile);

  const editableKeys = (profile: Profile): string[] => {
    const keys = Object.keys(profile.fields || {});
    if (canEdit(profile) && profile.holderId === null && !keys.includes('description') && !keys.includes('descricao')) {
      keys.push('description');
    }
    const priority = ['name', 'nome', 'apelido', 'displayName', 'display_name', 'nickname', 'description', 'descricao'];
    return keys.sort((a, b) => {
      const ai = priority.indexOf(a);
      const bi = priority.indexOf(b);
      return (ai < 0 ? priority.length : ai) - (bi < 0 ? priority.length : bi) || a.localeCompare(b);
    });
  };

  const fieldControl = (key: string, value: string): string => {
    const long = /description|descricao|bio|sobre|note|nota/i.test(key) || value.length > 120 || value.includes('\n');
    const control = long
      ? `<textarea name="${esc(key)}" data-profile-field rows="3" maxlength="4000">${esc(value)}</textarea>`
      : `<input type="text" name="${esc(key)}" data-profile-field maxlength="4000" value="${esc(value)}" autocomplete="off">`;
    return `<label class="profile-field"><span>${esc(labelFor(key))}</span>${control}</label>`;
  };

  const roleText = (profile: Profile): string => {
    const creator = isCreator(profile);
    const holder = isHolder(profile);
    if (creator && holder) return 'Criador e titular';
    if (holder) return 'Titular';
    if (creator && !profile.holderId) return 'Criador · perfil sem titular';
    if (creator) return 'Criador · titular em outra conta';
    return 'Acesso autorizado';
  };

  const badges = (profile: Profile): string => {
    const items: string[] = [];
    if (isCreator(profile)) items.push('<span class="profile-badge creator">Criador</span>');
    if (isHolder(profile)) items.push('<span class="profile-badge holder">Titular</span>');
    if (isCreator(profile) && !profile.holderId) items.push('<span class="profile-badge">Sem titular</span>');
    if (isCreator(profile) && profile.holderId && !isHolder(profile)) items.push('<span class="profile-badge">Titular em outra conta</span>');
    if (isHolder(profile) && !isCreator(profile)) items.push('<span class="profile-badge">Criado por outra conta</span>');
    if (isCreator(profile) && profile.creatorAccess === false) items.push('<span class="profile-badge">Acesso do criador retirado</span>');
    return items.join('');
  };

  const editForm = (profile: Profile, ref: string): string => {
    const draft = drafts.get(profile.id) || {...profile.fields};
    const fields = editableKeys(profile).map(key => fieldControl(key, String(draft[key] ?? ''))).join('');
    return `<form class="profile-form" data-profile-edit data-profile="${ref}">
      <fieldset>
        <legend>Editar dados do perfil</legend>
        <p class="muted">Altere apenas as informações que deseja atualizar.</p>
        ${fields}
        <div class="profile-form-actions">
          <button type="submit" class="profile-button primary">Salvar alterações</button>
          <button type="button" class="profile-button" data-action="profile-cancel">Cancelar</button>
        </div>
      </fieldset>
    </form>`;
  };

  const deletePanel = (profile: Profile, ref: string): string => `<div class="profile-confirm" role="group" aria-label="Confirmar exclusão do perfil">
    <p><strong>Excluir “${esc(nickname(profile))}”?</strong></p>
    <p>Esta ação exclui o perfil deste serviço e interrompe o acesso a ele. Não é possível desfazer. Cópias que você exportou para fora do Um não são recolhidas.</p>
    <div class="profile-form-actions">
      <button type="button" class="profile-button danger" data-action="profile-delete-confirm" data-profile="${ref}">Excluir definitivamente</button>
      <button type="button" class="profile-button" data-action="profile-delete-cancel">Cancelar</button>
    </div>
  </div>`;

  const exportPanel = (profile: Profile, ref: string): string => {
    const json = exportJson.get(profile.id);
    const error = exportErrors.get(profile.id);
    if (error) {
      return `<div class="profile-export" role="region" aria-label="Exportação JSON deste perfil">
        <p class="profile-error" role="alert">${esc(error)}</p>
        <p class="muted">Somente este perfil. Inclui os dados pessoais vinculados a este perfil.</p>
        <div class="profile-form-actions">
          <button type="button" class="profile-button" data-action="profile-export" data-profile="${ref}">Tentar novamente</button>
          <button type="button" class="profile-button" data-action="profile-close-export">Fechar</button>
        </div>
      </div>`;
    }
    if (!json) {
      return `<div class="profile-export" role="region" aria-label="Exportação JSON deste perfil">
        <p role="status">Preparando exportação…</p>
        <p class="muted">Somente este perfil. Inclui os dados pessoais vinculados a este perfil.</p>
      </div>`;
    }
    return `<div class="profile-export" role="region" aria-label="Exportação JSON deste perfil">
      <p class="muted">Somente este perfil. Inclui os dados pessoais vinculados a este perfil.</p>
      <textarea readonly rows="16" aria-label="Conteúdo JSON da exportação deste perfil">${esc(json)}</textarea>
      <div class="profile-form-actions">
        <button type="button" class="profile-button primary" data-action="profile-copy" data-profile="${ref}">Copiar JSON</button>
        <button type="button" class="profile-button" data-action="profile-close-export">Fechar</button>
      </div>
      <p class="muted">Copiar coloca o JSON na área de transferência. Nenhum download é iniciado.</p>
    </div>`;
  };

  const card = (profile: Profile): string => {
    const ref = refFor(profile.id);
    const editing = editRef === ref;
    const deleting = deleteRef === ref;
    const exporting = exportRef === ref;
    const error = cardErrors.get(profile.id);
    const description = descriptionOf(profile);
    const disabled = busy ? ' disabled' : '';
    const actions: string[] = [];
    if (canEdit(profile)) {
      actions.push(iconButton('edit', editing ? 'Fechar edição deste perfil' : 'Editar este perfil', 'profile-edit', `data-profile="${ref}" aria-pressed="${editing}"${disabled}`));
    }
    if (canExport(profile)) {
      actions.push(iconButton('book-open', 'Exportar dados deste perfil', 'profile-export', `data-profile="${ref}" aria-pressed="${exporting}"${disabled}`));
    }
    if (canRevokeCreator(profile)) {
      actions.push(iconButton('sign-out', 'Retirar acesso do criador', 'profile-revoke', `data-profile="${ref}"${disabled}`));
    }
    if (canMakePrivate(profile)) {
      actions.push(iconButton('offline', 'Tornar este perfil privado', 'profile-private', `data-profile="${ref}"${disabled}`));
    }
    if (canDelete(profile)) {
      actions.push(iconButton('trash', 'Excluir este perfil', 'profile-delete', `data-profile="${ref}"${disabled}`));
    }
    return `<article class="profile-card" data-card="${ref}">
      <div class="profile-card-head">
        <div class="profile-identity">
          <h3 class="profile-name">${esc(nickname(profile))}</h3>
          <div class="profile-badges">${badges(profile)}</div>
          <p class="profile-meta">${esc(roleText(profile))} · ${profile.visibility === 'public' ? 'Público' : 'Privado'}${!canEdit(profile) && !canManage(profile) ? ' · Somente leitura' : ''}</p>
        </div>
        ${actions.length ? `<div class="profile-actions">${actions.join('')}</div>` : ''}
      </div>
      ${description ? `<p class="profile-description">${esc(description)}</p>` : ''}
      ${!canEdit(profile) && !canManage(profile) ? '<p class="muted">A edição e os controles do perfil pertencem ao titular.</p>' : ''}
      ${canRevokeCreator(profile) ? '<p class="profile-warning">Retirar o acesso do criador não apaga cópias já exportadas ou baixadas.</p>' : ''}
      ${error ? `<p class="profile-error" role="alert">${esc(error)}</p>` : ''}
      ${editing ? editForm(profile, ref) : ''}
      ${deleting ? deletePanel(profile, ref) : ''}
      ${exporting ? exportPanel(profile, ref) : ''}
    </article>`;
  };

  const render = () => {
    if (disposed) return;
    view.innerHTML = `<div class="profile-view-head">
      <div>
        <h2 id="${headingId}" tabindex="-1">Perfis</h2>
        <p class="muted">Seus dados e os perfis que você pode acompanhar.</p>
      </div>
    </div>
    <p class="profile-status" data-status role="status" aria-live="polite">${esc(statusMessage)}</p>
    ${loadError ? `<div class="profile-load-error" role="alert"><p>${esc(loadError)}</p><button type="button" class="profile-button" data-action="profile-reload">Tentar novamente</button></div>` : ''}
    ${!loaded && !loadError ? '<p class="profile-empty" role="status">Carregando perfis…</p>' : ''}
    <div class="profile-list">${profiles.map(card).join('')}</div>
    ${loaded && !profiles.length && !loadError ? '<p class="profile-empty">Nenhum perfil próprio ou autorizado nesta conta.</p>' : ''}`;
    for(const button of view.querySelectorAll<HTMLButtonElement>('button.profile-button')){const label=button.textContent?.trim()||'Ação';button.setAttribute('aria-label',label);button.title=label;button.classList.add('icon-button');const action=button.dataset.action||'';button.innerHTML=renderUiIcon(button.type==='submit'?'save':action.includes('delete-confirm')?'trash':action.includes('copy')?'copy':action.includes('reload')?'reset':action.includes('export')?'book-open':'remove-state');}
  };

  const rebuildIndex = () => {
    byRef.clear();
    for (const profile of profiles) byRef.set(refFor(profile.id), profile);
    if (editRef && !byRef.has(editRef)) editRef = null;
    if (deleteRef && !byRef.has(deleteRef)) deleteRef = null;
    if (exportRef && !byRef.has(exportRef)) exportRef = null;
  };

  const loadProfiles = async () => {
    loaded = false;
    loadError = '';
    render();
    try {
      const collected: Profile[] = [];
      const seen = new Set<string>();
      const seenRaw = new Set<string>();
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await options.api('profile_list', {offset: page * PAGE_SIZE, limit: PAGE_SIZE});
        if (controller.signal.aborted) return;
        const items = isObject(response) && Array.isArray(response.items) ? response.items : [];
        let fresh = 0;
        for (const raw of items) {
          if (isObject(raw) && typeof raw.id === 'string' && !seenRaw.has(raw.id)) {
            seenRaw.add(raw.id);
            fresh += 1;
          }
          const profile = normalizeProfile(raw);
          if (profile && !seen.has(profile.id) && (profile.creatorId === accountId || profile.holderId === accountId)) {
            seen.add(profile.id);
            collected.push(profile);
          }
        }
        if (items.length < PAGE_SIZE) break;
        if (fresh === 0) break;
      }
      if (controller.signal.aborted) return;
      profiles = collected.sort((a, b) => {
        const aHolder = isHolder(a) ? 0 : 1;
        const bHolder = isHolder(b) ? 0 : 1;
        if (aHolder !== bHolder) return aHolder - bHolder;
        return nickname(a).localeCompare(nickname(b), 'pt-BR') || a.id.localeCompare(b.id);
      });
      const current = new Set(profiles.map(profile => profile.id));
      for (const profileId of [...refs.keys()]) {
        if (!current.has(profileId)) {
          refs.delete(profileId);
          drafts.delete(profileId);
          exportJson.delete(profileId);
          exportErrors.delete(profileId);
          cardErrors.delete(profileId);
        }
      }
      rebuildIndex();
      loaded = true;
      setStatus('');
      render();
    } catch (error) {
      if (controller.signal.aborted) return;
      loadError = messageOf(error);
      loaded = true;
      render();
      announce(loadError);
    }
  };

  const toggleEdit = (profile: Profile) => {
    const ref = refFor(profile.id);
    if (editRef === ref) {
      drafts.delete(profile.id);
      editRef = null;
      render();
      focusAction('profile-edit', ref);
      return;
    }
    editRef = ref;
    if (!drafts.has(profile.id)) {
      const draft: Record<string, string> = {...profile.fields};
      if (profile.holderId === null && !('description' in draft) && !('descricao' in draft)) draft.description = '';
      drafts.set(profile.id, draft);
    }
    render();
    view.querySelector<HTMLInputElement>('form[data-profile-edit] [data-profile-field]')?.focus();
  };

  const saveProfile = async (profile: Profile, form: HTMLFormElement, submit: HTMLButtonElement) => {
    const data = new FormData(form);
    const draft: Record<string, string> = {...profile.fields};
    const keys = editableKeys(profile);
    for (const key of keys) {
      const value = data.get(key);
      if (typeof value === 'string') draft[key] = value;
    }
    drafts.set(profile.id, draft);

    const changed: Record<string, string> = {};
    for (const key of keys) {
      const exists = Object.prototype.hasOwnProperty.call(profile.fields, key);
      const value = draft[key] ?? '';
      if (!exists && value.trim() === '') continue;
      if (!exists || (profile.fields[key] ?? '') !== value) changed[key] = value;
    }
    if (!Object.keys(changed).length) {
      setStatus('Nenhuma alteração para salvar.');
      return;
    }

    const intent = JSON.stringify(Object.keys(changed).sort().map(key => [key, changed[key]]));
    const id = operationId('update', profile.id, intent);
    if (!beginBusy(`update:${profile.id}`, submit)) return;
    cardErrors.delete(profile.id);
    clearCardError(profile.id);

    try {
      const response = await mutate('profile_update', {operationId: id, profileId: profile.id, fields: changed});
      if (controller.signal.aborted) return;
      if (!receiptConfirmed(response, id)) throw new Error('O serviço não confirmou as alterações. Tente novamente.');
      const result = receiptResult(response);
      profile.fields = {...profile.fields, ...changed};
      profile.revision = typeof result.revision === 'number' ? result.revision : profile.revision + 1;
      drafts.delete(profile.id);
      editRef = null;
      finishBusy(submit);
      setStatus('Alterações do perfil salvas.');
      render();
      focusAction('profile-edit', refFor(profile.id));
    } catch (error) {
      if (controller.signal.aborted) return;
      finishBusy(submit);
      const message = messageOf(error);
      cardErrors.set(profile.id, message);
      showCardError(profile.id, message);
      announce(message);
    }
  };

  const changeControl = async (profile: Profile, action: 'revoke_creator' | 'private' | 'delete', button: HTMLButtonElement) => {
    const ref = refFor(profile.id);
    const id = operationId('control', profile.id, action);
    if (!beginBusy(`control:${profile.id}:${action}`, button)) return;
    cardErrors.delete(profile.id);
    clearCardError(profile.id);

    try {
      const response = await mutate('profile_control', {operationId: id, profileId: profile.id, action});
      if (controller.signal.aborted) return;
      if (!receiptConfirmed(response, id)) throw new Error('O serviço não confirmou a ação. Tente novamente.');

      if (action === 'revoke_creator') profile.creatorAccess = false;
      if (action === 'private') profile.visibility = 'private';
      if (action === 'delete') {
        profiles = profiles.filter(item => item.id !== profile.id);
        refs.delete(profile.id);
        drafts.delete(profile.id);
        exportJson.delete(profile.id);
        exportErrors.delete(profile.id);
        cardErrors.delete(profile.id);
        if (editRef === ref) editRef = null;
        if (deleteRef === ref) deleteRef = null;
        if (exportRef === ref) exportRef = null;
        rebuildIndex();
      }

      const clean = await invalidate(profile.id);
      if (controller.signal.aborted || !view.isConnected) return;
      finishBusy(button);
      if (action === 'revoke_creator') {
        setStatus(clean
          ? 'Acesso do criador retirado. Cópias já exportadas ou baixadas não são recolhidas.'
          : 'Acesso do criador retirado. Recarregue a conta para atualizar os dados locais.');
      } else if (action === 'private') {
        setStatus(clean
          ? 'Perfil agora é privado. Cópias já exportadas ou baixadas não são recolhidas.'
          : 'Perfil agora é privado. Recarregue a conta para atualizar os dados locais.');
      } else {
        setStatus(clean ? 'Perfil excluído.' : 'Perfil excluído. Recarregue a conta para atualizar os dados locais.');
      }
      render();
      if (action === 'delete') view.querySelector<HTMLElement>('h2')?.focus();
      else focusAction('profile-edit', refs.get(profile.id) || ref);
    } catch (error) {
      if (controller.signal.aborted) return;
      finishBusy(button);
      const message = messageOf(error);
      cardErrors.set(profile.id, message);
      showCardError(profile.id, message);
      announce(message);
    }
  };

  const openExport = async (profile: Profile, button: HTMLButtonElement) => {
    const ref = refFor(profile.id);
    if (exportRef === ref && exportJson.has(profile.id)) {
      exportRef = null;
      render();
      focusAction('profile-export', ref);
      return;
    }
    exportRef = ref;
    exportErrors.delete(profile.id);
    cardErrors.delete(profile.id);
    clearCardError(profile.id);

    if (exportJson.has(profile.id)) {
      render();
      focusAction('profile-copy', ref);
      return;
    }

    if (!beginBusy(`export:${profile.id}`, button)) return;
    render();

    try {
      const content = await options.api('profile_export', {profileId: profile.id});
      if (controller.signal.aborted) return;
      if (!isObject(content)) throw new Error('O serviço não retornou a exportação deste perfil.');
      let json: string;
      try {
        json = JSON.stringify(content, null, 2);
      } catch {
        throw new Error('A exportação não pôde ser exibida.');
      }
      exportJson.set(profile.id, json);
      finishBusy(button);
      render();
      view.querySelector<HTMLTextAreaElement>('.profile-export textarea')?.focus();
    } catch (error) {
      if (controller.signal.aborted) return;
      finishBusy(button);
      const message = messageOf(error);
      exportErrors.set(profile.id, message);
      announce(message);
      render();
      focusAction('profile-export', ref);
    }
  };

  const copyExport = async (profile: Profile, button: HTMLButtonElement) => {
    const json = exportJson.get(profile.id);
    if (!json) return;
    if (!beginBusy(`copy:${profile.id}`, button)) return;
    cardErrors.delete(profile.id);
    clearCardError(profile.id);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('A cópia para a área de transferência não está disponível neste navegador.');
      await navigator.clipboard.writeText(json);
      if (controller.signal.aborted) return;
      finishBusy(button);
      setStatus('JSON da exportação copiado para a área de transferência.');
    } catch (error) {
      if (controller.signal.aborted) return;
      finishBusy(button);
      const message = messageOf(error);
      cardErrors.set(profile.id, message);
      showCardError(profile.id, message);
      announce(message);
    }
  };

  view.addEventListener('click', event => {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLButtonElement>('button[data-action]');
    if (!button || !view.contains(button) || button.disabled || busy) return;
    const action = button.dataset.action;
    const profileRef = button.dataset.profile;
    const profile = profileRef ? byRef.get(profileRef) : undefined;
    if (action === 'profile-reload') {
      void loadProfiles();
      return;
    }
    if (action === 'profile-edit' && profile) {
      toggleEdit(profile);
      return;
    }
    if (action === 'profile-cancel') {
      const current = editRef ? byRef.get(editRef) : undefined;
      const ref = editRef;
      if (current) drafts.delete(current.id);
      editRef = null;
      render();
      if (ref) focusAction('profile-edit', ref);
      return;
    }
    if (action === 'profile-export' && profile) {
      void openExport(profile, button);
      return;
    }
    if (action === 'profile-copy' && profile) {
      void copyExport(profile, button);
      return;
    }
    if (action === 'profile-close-export') {
      const ref = exportRef;
      exportRef = null;
      render();
      if (ref) focusAction('profile-export', ref);
      return;
    }
    if (action === 'profile-revoke' && profile) {
      void changeControl(profile, 'revoke_creator', button);
      return;
    }
    if (action === 'profile-private' && profile) {
      void changeControl(profile, 'private', button);
      return;
    }
    if (action === 'profile-delete' && profile) {
      deleteRef = refFor(profile.id);
      render();
      focusAction('profile-delete-confirm');
      return;
    }
    if (action === 'profile-delete-cancel') {
      const ref = deleteRef;
      deleteRef = null;
      render();
      if (ref) focusAction('profile-delete', ref);
      return;
    }
    if (action === 'profile-delete-confirm' && profile) {
      void changeControl(profile, 'delete', button);
    }
  }, {signal: controller.signal});

  view.addEventListener('submit', event => {
    const form = event.target as HTMLFormElement | null;
    if (!form || !form.matches('form[data-profile-edit]')) return;
    event.preventDefault();
    const ref = form.dataset.profile;
    const profile = ref ? byRef.get(ref) : undefined;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!profile || !submit || busy) return;
    void saveProfile(profile, form, submit);
  }, {signal: controller.signal});

  view.addEventListener('input', event => {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement | null;
    if (!input || !input.matches('[data-profile-field]')) return;
    const form = input.closest<HTMLFormElement>('form[data-profile-edit]');
    const ref = form?.dataset.profile;
    const profile = ref ? byRef.get(ref) : undefined;
    if (!profile) return;
    const draft = drafts.get(profile.id) || {...profile.fields};
    draft[input.name] = input.value;
    drafts.set(profile.id, draft);
  }, {signal: controller.signal});

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    view.remove();
  };

  await loadProfiles();
  return dispose;
}

