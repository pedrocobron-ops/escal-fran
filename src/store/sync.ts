// Sincronização entre aparelhos pelo Supabase: o localStorage continua sendo a cópia
// local (abre na hora, funciona sem internet) e a nuvem guarda uma linha por "código
// da escala". Quem tem o código vê e altera a mesma escala em qualquer aparelho.

import type { AppData } from '../domain';
import { COPY_PREFIX, migrate, parseBackup, type LoadResult, type StorageAdapter } from './storage';
import { CLOUD_PROJECT } from '../config/cloud';

export const SYNC_CONFIG_KEY = 'escala-ceo:sync';
export const SYNC_META_KEY = 'escala-ceo:sync-meta';

export interface SyncConfig {
  url: string;
  key: string;
  code: string;
}

interface SyncMeta {
  /** updated_at da nuvem que esta cópia local já tem (null = nunca sincronizou). */
  remoteAt: string | null;
  /** Há mudança local ainda não enviada. */
  dirty: boolean;
}

export type SyncStatus =
  | { state: 'off' }
  | { state: 'syncing' }
  | { state: 'ok'; at: string }
  | { state: 'offline'; error: string }
  | { state: 'error'; error: string }
  /** A nuvem tem uma versão mais nova e este aparelho tem mudanças não enviadas: a pessoa decide. */
  | { state: 'conflict'; remoteAt: string };

/**
 * Projeto Supabase do app: o de src/config/cloud.ts, ou o das variáveis de build
 * VITE_SUPABASE_URL e VITE_SUPABASE_KEY quando definidas (para apontar para outro projeto).
 */
export function builtInProject(): { url: string; key: string } | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const url = env.VITE_SUPABASE_URL?.trim() || CLOUD_PROJECT.url;
  const key = env.VITE_SUPABASE_KEY?.trim() || CLOUD_PROJECT.key;
  return url && key ? { url, key } : null;
}

export function readSyncConfig(store: Storage = window.localStorage): SyncConfig | null {
  try {
    const raw = store.getItem(SYNC_CONFIG_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SyncConfig>;
    const built = builtInProject();
    const url = (v.url || built?.url || '').trim();
    const key = (v.key || built?.key || '').trim();
    const code = (v.code || '').trim();
    return url && key && code ? { url, key, code } : null;
  } catch {
    return null;
  }
}

export function writeSyncConfig(cfg: Partial<SyncConfig> | null, store: Storage = window.localStorage): void {
  if (!cfg) {
    store.removeItem(SYNC_CONFIG_KEY);
    store.removeItem(SYNC_META_KEY);
    return;
  }
  store.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
}

export function readSyncMeta(store: Storage): SyncMeta {
  try {
    const raw = store.getItem(SYNC_META_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<SyncMeta>;
      return { remoteAt: typeof v.remoteAt === 'string' ? v.remoteAt : null, dirty: v.dirty === true };
    }
  } catch {
    // começa do zero
  }
  return { remoteAt: null, dirty: false };
}

export function writeSyncMeta(meta: SyncMeta, store: Storage): void {
  try {
    store.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    // sem espaço: o próximo ciclo tenta de novo
  }
}

/** Código novo, fácil de ditar: ceo-xxxx-xxxx-xxxx (sem letras e números parecidos). */
export function newSyncCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `ceo-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

/** Endereço do projeto com https:// e sem barra no fim. */
export function normalizeUrl(url: string): string {
  const t = url.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function normalizeCode(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '');
}

export class SyncError extends Error {
  constructor(message: string, readonly offline = false, readonly conflict = false) {
    super(message);
    this.name = 'SyncError';
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Chamadas às funções do Supabase (ver docs/supabase.sql). */
export class SupabaseRemote {
  constructor(private readonly cfg: SyncConfig, private readonly fetchFn: FetchLike = (i, o) => fetch(i, o)) {}

  private async rpc<T>(name: string, body: Record<string, unknown>, opts: { keepalive?: boolean; timeoutMs?: number } = {}): Promise<T> {
    const base = normalizeUrl(this.cfg.url);
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = ctrl && opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
    let res: Response;
    try {
      res = await this.fetchFn(`${base}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: this.cfg.key, Authorization: `Bearer ${this.cfg.key}` },
        body: JSON.stringify(body),
        keepalive: opts.keepalive,
        signal: ctrl?.signal,
      });
    } catch (e) {
      throw new SyncError(e instanceof Error && e.name === 'AbortError' ? 'A nuvem demorou para responder.' : 'Sem conexão com a nuvem.', true);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      let detail = '';
      try {
        const j = (await res.json()) as { message?: string; hint?: string };
        detail = j.message ?? '';
      } catch {
        // sem detalhe
      }
      if (/conflito/i.test(detail)) throw new SyncError('A nuvem tem uma versão mais nova.', false, true);
      if (res.status === 401 || res.status === 403) throw new SyncError('A nuvem recusou a chave do projeto.');
      if (res.status === 404) throw new SyncError('As funções da escala não existem nesse projeto (rode docs/supabase.sql).');
      if (res.status >= 500 || res.status === 429) throw new SyncError(`A nuvem está indisponível (${res.status}).`, true);
      throw new SyncError(detail ? `A nuvem recusou: ${detail}` : `A nuvem recusou a chamada (${res.status}).`);
    }
    const text = await res.text();
    try {
      return (text ? JSON.parse(text) : null) as T;
    } catch {
      throw new SyncError('A resposta da nuvem não é a esperada. Confira o endereço do projeto.');
    }
  }

  /** Escala guardada no código, ou null se o código ainda não tem nada. */
  async get(timeoutMs = 8000): Promise<{ raw: string; updatedAt: string } | null> {
    const rows = await this.rpc<Array<{ data: unknown; updated_at: string }>>('escala_get', { p_codigo: this.cfg.code }, { timeoutMs });
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row || row.data === null || row.data === undefined) return null;
    return { raw: JSON.stringify(row.data), updatedAt: row.updated_at };
  }

  async version(timeoutMs = 8000): Promise<string | null> {
    const v = await this.rpc<string | null>('escala_version', { p_codigo: this.cfg.code }, { timeoutMs });
    return typeof v === 'string' ? v : null;
  }

  /**
   * Grava e devolve o updated_at novo. Com `expected`, só grava se a nuvem ainda estiver
   * naquela versão (senão a função do banco devolve "conflito").
   */
  async put(data: AppData, opts: { keepalive?: boolean; timeoutMs?: number; expected?: string | null } = {}): Promise<string> {
    // keepalive (ao fechar a página) só vale para corpos pequenos (limite do navegador, 64 KB);
    // acima disso o envio normal é tentado, e, se não der tempo, a cópia local fica marcada
    // como pendente e sobe na próxima abertura.
    const keepalive = opts.keepalive && JSON.stringify(data).length < 60000;
    const v = await this.rpc<string>('escala_put', { p_codigo: this.cfg.code, p_data: data, p_expected: opts.expected ?? null }, { timeoutMs: opts.timeoutMs ?? 15000, keepalive });
    if (typeof v !== 'string') throw new SyncError('A nuvem não confirmou a gravação.');
    return v;
  }
}

function clock(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

const PUSH_DELAY_MS = 1500;
const POLL_MS = 30000;

/**
 * Adapter que junta a cópia local com a nuvem.
 * - load: lê o local e confere a nuvem; o mais novo vence (uma mudança local ainda não
 *   enviada vence a nuvem, porque é o que a pessoa está fazendo agora).
 * - save: grava local na hora e envia para a nuvem logo depois (junta mudanças seguidas).
 * - subscribe: além das outras abas, confere a nuvem de tempos em tempos.
 */
export class SyncedAdapter implements StorageAdapter {
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: AppData | null = null;
  private pushing = false;
  private checking = false;
  private meta: SyncMeta;
  private lastSeenRemoteAt: string | null = null;
  /** Versão da nuvem que bateu de frente com uma mudança daqui (esperando a decisão da pessoa). */
  private conflict: { raw: string; updatedAt: string } | null = null;

  constructor(
    private readonly local: StorageAdapter,
    private readonly remote: SupabaseRemote,
    private readonly store: Storage,
    private readonly onStatus: (s: SyncStatus) => void,
    private readonly visible: () => boolean = () => (typeof document === 'undefined' ? true : document.visibilityState === 'visible'),
  ) {
    this.meta = readSyncMeta(store);
  }

  private setMeta(meta: SyncMeta) {
    this.meta = meta;
    writeSyncMeta(meta, this.store);
  }

  private async keepCopySafe(raw: string) {
    try {
      await this.local.keepCopy(raw);
      pruneCopies(this.store, 5);
    } catch {
      // sem espaço para a cópia: segue sem ela
    }
  }

  private enterConflict(remote: { raw: string; updatedAt: string }, pending: AppData) {
    this.conflict = remote;
    this.pending = pending;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    this.onStatus({ state: 'conflict', remoteAt: remote.updatedAt });
  }

  /**
   * Decisão da pessoa num conflito: 'mine' manda a versão deste aparelho por cima da nuvem;
   * 'cloud' usa a da nuvem e descarta as mudanças daqui. A versão perdedora fica guardada
   * como cópia de segurança no navegador.
   */
  async resolveConflict(choice: 'mine' | 'cloud', onData: (data: AppData) => void): Promise<void> {
    const c = this.conflict;
    if (!c) return;
    if (choice === 'mine') {
      const mine = this.pending;
      this.conflict = null;
      if (!mine) return;
      await this.keepCopySafe(c.raw);
      this.pending = null;
      this.pushing = true;
      this.onStatus({ state: 'syncing' });
      try {
        const at = await this.remote.put(mine, { expected: c.updatedAt });
        this.setMeta({ remoteAt: at, dirty: false });
        this.lastSeenRemoteAt = at;
        this.onStatus({ state: 'ok', at: clock() });
      } catch (e) {
        if (e instanceof SyncError && e.conflict) {
          const fresh = await this.remote.get().catch(() => null);
          if (fresh) this.enterConflict(fresh, mine);
          else this.fail(e);
        } else {
          this.pending = mine;
          this.fail(e);
        }
      } finally {
        this.pushing = false;
      }
      return;
    }
    const local = await this.local.load();
    if (local.status === 'ok') await this.keepCopySafe(JSON.stringify(local.data));
    else if (local.status === 'invalid') await this.keepCopySafe(local.raw);
    try {
      const data = migrate(parseBackup(c.raw));
      this.conflict = null;
      this.pending = null;
      await this.local.save(data);
      this.setMeta({ remoteAt: c.updatedAt, dirty: false });
      this.lastSeenRemoteAt = c.updatedAt;
      this.onStatus({ state: 'ok', at: clock() });
      onData(data);
    } catch (e) {
      this.onStatus({ state: 'error', error: `A escala na nuvem está com problema: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  private fail(e: unknown) {
    const err = e instanceof SyncError ? e : new SyncError(e instanceof Error ? e.message : 'Erro ao sincronizar.');
    this.onStatus(err.offline ? { state: 'offline', error: err.message } : { state: 'error', error: err.message });
  }

  async load(): Promise<LoadResult> {
    const localResult = await this.local.load();
    this.onStatus({ state: 'syncing' });
    let remote: { raw: string; updatedAt: string } | null;
    try {
      remote = await this.remote.get(6000);
    } catch (e) {
      this.fail(e);
      return localResult;
    }
    if (!remote) {
      // Código ainda vazio: este aparelho é o primeiro; o que estiver aqui sobe no próximo save.
      if (localResult.status === 'ok') {
        this.schedulePush(localResult.data, 0);
      }
      this.onStatus({ state: 'ok', at: clock() });
      return localResult;
    }
    if (localResult.status === 'ok' && this.meta.dirty) {
      if (remote.updatedAt !== this.meta.remoteAt) {
        // Mudança daqui não enviada e a nuvem mudou por outro aparelho: a pessoa decide.
        this.enterConflict(remote, localResult.data);
        return localResult;
      }
      this.schedulePush(localResult.data, 0);
      this.onStatus({ state: 'ok', at: clock() });
      return localResult;
    }
    if (localResult.status === 'ok' && remote.updatedAt === this.meta.remoteAt) {
      this.onStatus({ state: 'ok', at: clock() });
      return localResult;
    }
    // A nuvem é mais nova (ou este aparelho nunca sincronizou): usa a nuvem.
    let data: AppData;
    try {
      data = migrate(parseBackup(remote.raw));
    } catch (e) {
      this.onStatus({ state: 'error', error: `A escala na nuvem está com problema: ${e instanceof Error ? e.message : String(e)}` });
      return localResult;
    }
    if (localResult.status === 'invalid') await this.keepCopySafe(localResult.raw);
    await this.local.save(data);
    this.setMeta({ remoteAt: remote.updatedAt, dirty: false });
    this.lastSeenRemoteAt = remote.updatedAt;
    this.onStatus({ state: 'ok', at: clock() });
    return { status: 'ok', data };
  }

  async save(data: AppData): Promise<void> {
    const p = this.local.save(data);
    this.setMeta({ ...this.meta, dirty: true });
    this.schedulePush(data, PUSH_DELAY_MS);
    await p;
  }

  async clear(): Promise<void> {
    await this.local.clear();
  }

  keepCopy(raw: string): Promise<string> {
    return this.local.keepCopy(raw);
  }

  private schedulePush(data: AppData, delay: number) {
    this.pending = data;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.pushNow();
    }, delay);
  }

  private async pushNow(keepalive = false): Promise<void> {
    if (this.pushing || this.conflict) return;
    if (this.checking) {
      // Uma conferência da nuvem está no meio: espera ela terminar.
      if (this.pending) this.schedulePush(this.pending, 500);
      return;
    }
    const data = this.pending;
    if (!data) return;
    this.pending = null;
    this.pushing = true;
    this.onStatus({ state: 'syncing' });
    try {
      const at = await this.remote.put(data, { keepalive, timeoutMs: keepalive ? 4000 : 15000, expected: this.meta.remoteAt });
      this.setMeta({ remoteAt: at, dirty: this.pending !== null });
      this.lastSeenRemoteAt = at;
      this.onStatus({ state: 'ok', at: clock() });
    } catch (e) {
      if (e instanceof SyncError && e.conflict) {
        // Alguém gravou na nuvem depois da última versão que este aparelho viu.
        const latest = this.pending ?? data;
        const fresh = await this.remote.get().catch(() => null);
        if (fresh) this.enterConflict(fresh, latest);
        else {
          this.pending = latest;
          this.fail(e);
        }
      } else {
        // Fica pendente: tenta de novo na próxima mudança ou na próxima conferência.
        if (!this.pending) this.pending = data;
        this.fail(e);
      }
    } finally {
      this.pushing = false;
      if (this.pending && !this.pushTimer && !this.conflict) this.schedulePush(this.pending, PUSH_DELAY_MS);
    }
  }

  flush(): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    if (this.pending) void this.pushNow(true);
  }

  /** Confere a nuvem: se mudou lá e não há mudança pendente aqui, traz a versão nova. */
  async check(onChange: (data: AppData) => void): Promise<void> {
    if (this.pushing || this.checking || this.conflict) return;
    if (this.pending) {
      // Ficou algo para enviar (sem conexão antes): tenta agora (com conferência de versão).
      if (this.pushTimer) clearTimeout(this.pushTimer);
      this.pushTimer = null;
      await this.pushNow();
      return;
    }
    this.checking = true;
    try {
      let version: string | null;
      try {
        version = await this.remote.version(8000);
      } catch (e) {
        this.fail(e);
        return;
      }
      if (!version || version === this.meta.remoteAt || version === this.lastSeenRemoteAt) {
        this.onStatus({ state: 'ok', at: clock() });
        return;
      }
      if (this.meta.dirty || this.pending) {
        // Esta cópia tem mudança não enviada: o envio (com conferência de versão) decide.
        const local = await this.local.load();
        if (local.status === 'ok') this.schedulePush(this.pending ?? local.data, 0);
        return;
      }
      let remote: { raw: string; updatedAt: string } | null;
      try {
        remote = await this.remote.get(8000);
      } catch (e) {
        this.fail(e);
        return;
      }
      if (!remote) return;
      // Mudou algo aqui enquanto a nuvem respondia: o envio pendente vai bater na conferência de versão.
      if (this.pending) return;
      try {
        const data = migrate(parseBackup(remote.raw));
        await this.local.save(data);
        this.setMeta({ remoteAt: remote.updatedAt, dirty: false });
        this.lastSeenRemoteAt = remote.updatedAt;
        this.onStatus({ state: 'ok', at: clock() });
        onChange(data);
      } catch (e) {
        this.fail(e);
      }
    } finally {
      this.checking = false;
    }
  }

  subscribe(onChange: (data: AppData) => void): () => void {
    const stopLocal = this.local.subscribe?.(onChange) ?? (() => undefined);
    const tick = () => {
      if (this.visible()) void this.check(onChange);
    };
    const timer = setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (this.visible()) tick();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    if (typeof window !== 'undefined') window.addEventListener('online', onVisible);
    return () => {
      clearInterval(timer);
      stopLocal();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      if (typeof window !== 'undefined') window.removeEventListener('online', onVisible);
    };
  }
}

/** Cópias de segurança guardadas no navegador (chave e data). */
export function listCopies(store: Storage): Array<{ key: string; when: string }> {
  const out: Array<{ key: string; when: string }> = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(COPY_PREFIX)) out.push({ key: k, when: k.slice(COPY_PREFIX.length) });
  }
  return out.sort((a, b) => b.key.localeCompare(a.key));
}

/** Limpa as cópias de segurança antigas guardadas no navegador (mantém as últimas). */
export function pruneCopies(store: Storage, keep = 5): void {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(COPY_PREFIX)) keys.push(k);
  }
  keys.sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - keep))) store.removeItem(k);
}
