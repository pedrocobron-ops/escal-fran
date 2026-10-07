// Login com e-mail e senha: sessão, renovação do token, link de "esqueci a senha",
// a nuvem por conta e a importação do código antigo.
import { describe, expect, it, vi } from 'vitest';
import { AuthClient, AuthError, LAST_USER_KEY, SESSION_KEY, parseRecoveryHash, readSession, type Session } from '../src/store/auth';
import { SupabaseRemote, clearLegacyCode, readLegacyCode } from '../src/store/sync';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear(), map: m } as unknown as Storage & { map: Map<string, string> };
};
const project = { url: 'https://x.supabase.co', key: 'anon' };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });

function gotrue(opts: { password?: string; refreshOk?: boolean } = {}) {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  let n = 0;
  const fetchFn = async (url: string, init?: RequestInit) => {
    const path = url.replace('https://x.supabase.co/auth/v1/', '');
    calls.push({ path, init: init ?? {} });
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (path === 'token?grant_type=password') {
      if (body.password !== (opts.password ?? 'segredo123')) return json({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      n++;
      return json({ access_token: `acc${n}`, refresh_token: `ref${n}`, expires_in: 3600, user: { id: 'u1', email: String(body.email) } });
    }
    if (path === 'token?grant_type=refresh_token') {
      if (opts.refreshOk === false) return json({ error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }, 400);
      n++;
      return json({ access_token: `acc${n}`, refresh_token: `ref${n}`, expires_in: 3600, user: { id: 'u1', email: 'f@x' } });
    }
    if (path === 'logout') return new Response(null, { status: 204 });
    if (path.startsWith('recover')) return json({});
    if (path === 'user' && init?.method === 'PUT') return json({ id: 'u1', email: 'f@x' });
    if (path === 'user') return json({ id: 'u1', email: 'f@x' });
    return json({ msg: 'no' }, 404);
  };
  return { calls, fetchFn };
}

describe('login: sessão e token', () => {
  it('entra, guarda a sessão e sai', async () => {
    const store = mem();
    const g = gotrue();
    let now = 1000;
    const auth = new AuthClient(project, store, g.fetchFn, () => now);
    expect(auth.session).toBeNull();
    const seen: Array<Session | null> = [];
    auth.subscribe((s) => seen.push(s));
    const s = await auth.login(' F@X ', 'segredo123');
    expect(s.user).toEqual({ id: 'u1', email: 'F@X' });
    expect(s.expiresAt).toBe(4600);
    expect(readSession(store)?.accessToken).toBe('acc1');
    expect(JSON.parse(String(g.calls[0].init.body)).email).toBe('F@X');
    expect((g.calls[0].init.headers as Record<string, string>).apikey).toBe('anon');
    // token válido não renova
    expect(await auth.token()).toBe('acc1');
    // perto de vencer, renova sozinho (uma vez só, mesmo com chamadas paralelas)
    now = 4590;
    const [a, b] = await Promise.all([auth.token(), auth.token()]);
    expect(a).toBe('acc2');
    expect(b).toBe('acc2');
    expect(g.calls.filter((c) => c.path === 'token?grant_type=refresh_token').length).toBe(1);
    // force renova de novo
    expect(await auth.token(true)).toBe('acc3');
    await auth.logout();
    expect(auth.session).toBeNull();
    expect(store.getItem(SESSION_KEY)).toBeNull();
    expect(g.calls.some((c) => c.path === 'logout' && (c.init.headers as Record<string, string>).Authorization === 'Bearer acc3')).toBe(true);
    expect(seen[seen.length - 1]).toBeNull();
    await expect(auth.token()).rejects.toMatchObject({ kind: 'sem-sessao' });
  });

  it('senha errada, muitas tentativas e nuvem fora do ar dão mensagens claras', async () => {
    const store = mem();
    const auth = new AuthClient(project, store, gotrue().fetchFn);
    await expect(auth.login('f@x', 'errada')).rejects.toMatchObject({ kind: 'credenciais', message: 'E-mail ou senha incorretos.' });
    const limited = new AuthClient(project, store, async () => json({ error_code: 'over_request_rate_limit' }, 429));
    await expect(limited.login('f@x', 'x')).rejects.toMatchObject({ kind: 'muitas-tentativas' });
    const down = new AuthClient(project, store, async () => json({}, 500));
    await expect(down.login('f@x', 'x')).rejects.toMatchObject({ kind: 'servidor' });
    const offline = new AuthClient(project, store, async () => { throw new TypeError('fail'); });
    await expect(offline.login('f@x', 'x')).rejects.toMatchObject({ kind: 'offline' });
    expect(new AuthError('x', 'email').kind).toBe('email');
  });

  it('sessão guardada é reaberta; renovação recusada derruba a sessão', async () => {
    const store = mem();
    store.setItem(SESSION_KEY, JSON.stringify({ accessToken: 'old', refreshToken: 'r', expiresAt: 100, user: { id: 'u1', email: 'f@x' } }));
    const g = gotrue({ refreshOk: false });
    const auth = new AuthClient(project, store, g.fetchFn, () => 1000);
    expect(auth.session?.user.email).toBe('f@x');
    await expect(auth.token()).rejects.toMatchObject({ kind: 'sem-sessao' });
    expect(auth.session).toBeNull();
    expect(readSession(store)).toBeNull();
    // sessão inválida no armazenamento é ignorada
    store.setItem(SESSION_KEY, '{"accessToken":1}');
    expect(readSession(store)).toBeNull();
  });

  it('esqueci a senha: manda o e-mail com o endereço de volta e troca a senha pelo link', async () => {
    const store = mem();
    const g = gotrue();
    const auth = new AuthClient(project, store, g.fetchFn, () => 1000);
    await auth.recover('f@x', 'https://site/app/');
    const rec = g.calls.find((c) => c.path.startsWith('recover'))!;
    expect(rec.path).toBe('recover?redirect_to=https%3A%2F%2Fsite%2Fapp%2F');
    expect(JSON.parse(String(rec.init.body))).toEqual({ email: 'f@x' });
    const s = parseRecoveryHash('#access_token=tokR&refresh_token=refR&expires_in=3600&type=recovery', 1000);
    expect(s).toMatchObject({ accessToken: 'tokR', refreshToken: 'refR', expiresAt: 4600 });
    expect(parseRecoveryHash('#/quadro')).toBeNull();
    expect(parseRecoveryHash('#access_token=a&refresh_token=b&type=magiclink')).toBeNull();
    auth.adopt(s!);
    expect(await auth.whoami()).toEqual({ id: 'u1', email: 'f@x' });
    expect(auth.session?.user.id).toBe('u1');
    await auth.updatePassword('novaSenha123');
    const put = g.calls.find((c) => c.path === 'user' && c.init.method === 'PUT')!;
    expect((put.init.headers as Record<string, string>).Authorization).toBe('Bearer tokR');
    expect(JSON.parse(String(put.init.body))).toEqual({ password: 'novaSenha123' });
  });
});

describe('nuvem por conta', () => {
  it('chama as funções da conta com o token; renova e repete num 401; importa o código antigo', async () => {
    const seen: Array<{ name: string; auth: string; body: Record<string, unknown> }> = [];
    let expired = true;
    const fetchFn = async (url: string, init?: RequestInit) => {
      const name = url.split('/rpc/')[1];
      const h = init?.headers as Record<string, string>;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      seen.push({ name, auth: h.Authorization, body });
      if (expired) { expired = false; return json({ message: 'JWT expired' }, 401); }
      if (name === 'minha_escala_get') return json([{ data: { x: 1 }, updated_at: '2026-10-07T10:00:00Z' }]);
      if (name === 'minha_escala_version') return json('2026-10-07T10:00:00Z');
      if (name === 'minha_escala_put') return json('2026-10-07T10:00:01Z');
      if (name === 'minha_escala_importar_codigo') return json(body.p_codigo === 'ceo-velho-0000-0000' ? '2026-10-07T09:00:00Z' : null);
      if (name === 'cleo_conversa_get') return json({ items: [], messages: [] });
      if (name === 'cleo_conversa_put') return new Response(null, { status: 204 });
      return json({ message: 'no' }, 404);
    };
    let n = 0;
    const token = async (force?: boolean) => { if (force) n++; return `tok${n}`; };
    const remote = new SupabaseRemote(project, token, fetchFn);
    const got = await remote.get();
    expect(got).toEqual({ raw: '{"x":1}', updatedAt: '2026-10-07T10:00:00Z' });
    // primeira tentativa com tok0 deu 401, renovou e repetiu com tok1
    expect(seen.map((s) => s.auth)).toEqual(['Bearer tok0', 'Bearer tok1']);
    expect(seen[1].body).toEqual({});
    expect(await remote.version()).toBe('2026-10-07T10:00:00Z');
    expect(await remote.put({ a: 1 } as never, { expected: '2026-10-07T10:00:00Z' })).toBe('2026-10-07T10:00:01Z');
    expect(seen[seen.length - 1].body).toEqual({ p_data: { a: 1 }, p_expected: '2026-10-07T10:00:00Z' });
    expect(await remote.importCode('ceo-velho-0000-0000')).toBe('2026-10-07T09:00:00Z');
    expect(await remote.importCode('ceo-nao-exis-te00')).toBeNull();
    expect(await remote.conversaGet()).toEqual({ items: [], messages: [] });
    await remote.conversaPut({ items: [], messages: [] });
    expect(seen[seen.length - 1].body).toEqual({ p_messages: { items: [], messages: [] } });
  });

  it('o código antigo guardado neste navegador é lido uma vez e apagado', () => {
    const store = mem();
    expect(readLegacyCode(store)).toBeNull();
    store.setItem('escala-ceo:sync', JSON.stringify({ code: ' CEO-ABCD-EFGH-JKLM ' }));
    expect(readLegacyCode(store)).toBe('ceo-abcd-efgh-jklm');
    clearLegacyCode(store);
    expect(readLegacyCode(store)).toBeNull();
    expect(LAST_USER_KEY).toBe('escala-ceo:ultimo-usuario');
  });

  it('sem sessão, a nuvem avisa que precisa entrar (não fica tentando)', async () => {
    const remote = new SupabaseRemote(project, async () => { throw new AuthError('Entre com seu e-mail e senha.', 'sem-sessao'); }, async () => json({}));
    await expect(remote.get()).rejects.toMatchObject({ auth: true, message: 'Entre com seu e-mail e senha.' });
    vi.restoreAllMocks();
  });
});
