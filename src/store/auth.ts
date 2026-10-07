// Login com e-mail e senha (Supabase Auth, chamadas diretas à API, sem biblioteca).
// A sessão fica no localStorage e é renovada sozinha antes de vencer.

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Vencimento do accessToken, em segundos desde 1970. */
  expiresAt: number;
  user: { id: string; email: string };
}

export const SESSION_KEY = 'escala-ceo:sessao';
/** Último usuário que usou este navegador (para limpar a cópia local se outro entrar). */
export const LAST_USER_KEY = 'escala-ceo:ultimo-usuario';

export type AuthErrorKind = 'credenciais' | 'offline' | 'servidor' | 'sem-sessao' | 'muitas-tentativas' | 'senha-fraca' | 'email';

export class AuthError extends Error {
  constructor(message: string, readonly kind: AuthErrorKind) {
    super(message);
    this.name = 'AuthError';
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function readSession(store: Storage): Session | null {
  try {
    const raw = store.getItem(SESSION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Session>;
    if (typeof v.accessToken !== 'string' || typeof v.refreshToken !== 'string' || typeof v.expiresAt !== 'number' || !v.user || typeof v.user.id !== 'string') return null;
    return { accessToken: v.accessToken, refreshToken: v.refreshToken, expiresAt: v.expiresAt, user: { id: v.user.id, email: typeof v.user.email === 'string' ? v.user.email : '' } };
  } catch {
    return null;
  }
}

export function writeSession(session: Session | null, store: Storage): void {
  try {
    if (session) store.setItem(SESSION_KEY, JSON.stringify(session));
    else store.removeItem(SESSION_KEY);
  } catch {
    // sem espaço ou armazenamento bloqueado: a sessão vale só nesta aba
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id: string; email?: string };
}

function toSession(t: TokenResponse, nowSec: number): Session {
  const expiresAt = typeof t.expires_at === 'number' ? t.expires_at : nowSec + (t.expires_in ?? 3600);
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt, user: { id: t.user?.id ?? '', email: t.user?.email ?? '' } };
}

/** Dados da sessão que vêm no endereço depois do link "esqueci a senha" (#access_token=...&type=recovery). */
export function parseRecoveryHash(hash: string, nowSec = Math.floor(Date.now() / 1000)): Session | null {
  const q = hash.replace(/^#\/?/, '');
  if (!q.includes('access_token=')) return null;
  const p = new URLSearchParams(q);
  const access = p.get('access_token');
  const refresh = p.get('refresh_token');
  if (!access || !refresh || p.get('type') !== 'recovery') return null;
  const expiresIn = Number(p.get('expires_in') ?? '3600');
  return { accessToken: access, refreshToken: refresh, expiresAt: nowSec + (Number.isFinite(expiresIn) ? expiresIn : 3600), user: { id: '', email: '' } };
}

const RENEW_BEFORE_SEC = 60;

export class AuthClient {
  private current: Session | null;
  private refreshing: Promise<Session> | null = null;
  private listeners = new Set<(s: Session | null) => void>();

  constructor(
    private readonly project: { url: string; key: string },
    private readonly store: Storage,
    private readonly fetchFn: FetchLike = (i, o) => fetch(i, o),
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    this.current = readSession(store);
  }

  get session(): Session | null {
    return this.current;
  }

  subscribe(fn: (s: Session | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(session: Session | null) {
    this.current = session;
    writeSession(session, this.store);
    for (const fn of this.listeners) fn(session);
  }

  private async call(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
    const base = this.project.url.replace(/\/+$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: this.project.key, ...((init.headers as Record<string, string>) ?? {}) };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    try {
      return await this.fetchFn(`${base}/auth/v1/${path}`, { ...init, headers });
    } catch {
      throw new AuthError('Sem conexão com a nuvem. Confira a internet e tente de novo.', 'offline');
    }
  }

  private async fail(res: Response, fallback: string): Promise<never> {
    let code = '';
    let msg = '';
    try {
      const j = (await res.json()) as { error_code?: string; error?: string; msg?: string; message?: string; error_description?: string };
      code = j.error_code ?? j.error ?? '';
      msg = j.msg ?? j.message ?? j.error_description ?? '';
    } catch {
      // sem corpo
    }
    if (res.status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') throw new AuthError('Muitas tentativas seguidas. Espere um minuto e tente de novo.', 'muitas-tentativas');
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      if (/weak|password should|at least|senha/i.test(msg) || code === 'weak_password') throw new AuthError('Senha fraca: use pelo menos 8 caracteres.', 'senha-fraca');
      if (/email/i.test(code) || /valid email|email address/i.test(msg)) throw new AuthError('Confira o e-mail digitado.', 'email');
      throw new AuthError('E-mail ou senha incorretos.', 'credenciais');
    }
    throw new AuthError(`${fallback} (${res.status}).`, 'servidor');
  }

  async login(email: string, password: string): Promise<Session> {
    const res = await this.call('token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) });
    if (!res.ok) await this.fail(res, 'A nuvem não respondeu ao login');
    const session = toSession((await res.json()) as TokenResponse, this.now());
    this.set(session);
    return session;
  }

  /** Sai: avisa a nuvem (se der) e esquece a sessão aqui. */
  async logout(): Promise<void> {
    const s = this.current;
    this.set(null);
    if (s) {
      try {
        await this.call('logout', { method: 'POST', token: s.accessToken });
      } catch {
        // sem rede: a sessão já foi esquecida aqui, e o token vence sozinho
      }
    }
  }

  /** Manda o e-mail de "esqueci a senha"; o link volta para o app com o tipo recovery. */
  async recover(email: string, redirectTo: string): Promise<void> {
    const res = await this.call(`recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
    if (!res.ok) await this.fail(res, 'Não deu para mandar o e-mail');
  }

  /** Usa a sessão que veio no link de recuperação (ou qualquer sessão externa). */
  adopt(session: Session): void {
    this.set(session);
  }

  async updatePassword(password: string): Promise<void> {
    const token = await this.token();
    const res = await this.call('user', { method: 'PUT', token, body: JSON.stringify({ password }) });
    if (!res.ok) await this.fail(res, 'Não deu para trocar a senha');
  }

  /** Dados do usuário da sessão (preenche id e e-mail quando a sessão veio de um link). */
  async whoami(): Promise<{ id: string; email: string }> {
    const token = await this.token();
    const res = await this.call('user', { method: 'GET', token });
    if (!res.ok) await this.fail(res, 'Não deu para ler a conta');
    const u = (await res.json()) as { id: string; email?: string };
    if (this.current) this.set({ ...this.current, user: { id: u.id, email: u.email ?? '' } });
    return { id: u.id, email: u.email ?? '' };
  }

  /**
   * Token válido para chamar a nuvem. Renova sozinho quando está para vencer (ou com
   * force=true, depois de um 401). Sem sessão, ou se a renovação for recusada, a pessoa
   * precisa entrar de novo.
   */
  async token(force = false): Promise<string> {
    const s = this.current;
    if (!s) throw new AuthError('Entre com seu e-mail e senha.', 'sem-sessao');
    if (!force && s.expiresAt - this.now() > RENEW_BEFORE_SEC) return s.accessToken;
    if (!this.refreshing) {
      this.refreshing = this.refresh(s).finally(() => {
        this.refreshing = null;
      });
    }
    return (await this.refreshing).accessToken;
  }

  private async refresh(s: Session): Promise<Session> {
    const res = await this.call('token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: s.refreshToken }) });
    if (!res.ok) {
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        // Sessão vencida ou invalidada (ex.: senha trocada em outro aparelho).
        this.set(null);
        throw new AuthError('Sua sessão venceu. Entre de novo.', 'sem-sessao');
      }
      throw new AuthError(`A nuvem não renovou a sessão (${res.status}).`, 'servidor');
    }
    const t = (await res.json()) as TokenResponse;
    const next = toSession({ ...t, user: t.user ?? s.user }, this.now());
    if (!next.user.id) next.user = s.user;
    this.set(next);
    return next;
  }
}
