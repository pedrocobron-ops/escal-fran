// Função "cleo": recebe a conversa do app, confere a conta (token da sessão) e o limite diário,
// e repassa à API da Anthropic com a chave guardada nos segredos do projeto.
// Este arquivo é puro (sem Deno.*) para ser testado com Vitest; index.ts o liga ao Deno.serve.

export interface Env {
  ANTHROPIC_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  /** Chaves "publishable" novas, em JSON (o painel do Supabase define). */
  SUPABASE_PUBLISHABLE_KEYS?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Modelo da Anthropic. Padrão: Haiku 4.5 (rápido e barato). */
  CLEO_MODEL?: string;
  /** Limite de chamadas por código por dia. Padrão: 300. */
  CLEO_LIMITE_DIA?: string;
}

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;
const MAX_MESSAGES = 60;
const MAX_BODY = 400_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

interface Autoriza {
  ok: boolean;
  motivo?: 'login' | 'limite';
  restantes?: number;
}

/** Chaves públicas do projeto que o app pode mandar: a anon antiga e as "publishable" novas. */
export function allowedKeys(env: Env): Set<string> {
  const keys = new Set<string>();
  if (env.SUPABASE_ANON_KEY) keys.add(env.SUPABASE_ANON_KEY);
  if (env.SUPABASE_PUBLISHABLE_KEYS) {
    try {
      const parsed = JSON.parse(env.SUPABASE_PUBLISHABLE_KEYS) as unknown;
      const values = Array.isArray(parsed) ? parsed : typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
      for (const v of values) {
        if (typeof v === 'string') keys.add(v);
        else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) if (typeof x === 'string' && x.length > 20) keys.add(x);
      }
    } catch {
      // formato desconhecido: fica só a anon
    }
  }
  return keys;
}

/**
 * A chave anon antiga é um JWT com o ref do projeto e role "anon". O ambiente da função
 * nem sempre traz essa chave em SUPABASE_ANON_KEY (projetos novos trazem a "publishable"),
 * então aceitamos também pelo conteúdo. É uma chave pública: o segredo de verdade é o código.
 */
export function isProjectAnonJwt(key: string, env: Env): boolean {
  const ref = (env.SUPABASE_URL ?? '').match(/^https?:\/\/([a-z0-9]+)\.supabase\.(co|in)/)?.[1];
  if (!ref) return false;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { ref?: unknown; role?: unknown };
    return payload.ref === ref && payload.role === 'anon';
  } catch {
    return false;
  }
}

async function fingerprint(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf).slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Usuário dono do token da sessão (Supabase Auth), ou '' se o token não vale. */
async function userIdOf(env: Env, apikey: string, bearer: string, fetchFn: typeof fetch): Promise<string> {
  const res = await fetchFn(`${env.SUPABASE_URL}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey, Authorization: `Bearer ${bearer}` },
  });
  if (res.status === 401 || res.status === 403) return '';
  if (!res.ok) throw new Error(`auth ${res.status}`);
  const u = (await res.json()) as { id?: unknown };
  return typeof u.id === 'string' ? u.id : '';
}

/** Conta a chamada do dia da conta (função SQL public.cleo_autoriza_usuario, só com service role). */
async function autoriza(env: Env, userId: string, fetchFn: typeof fetch): Promise<Autoriza> {
  const res = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/cleo_autoriza_usuario`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
    },
    body: JSON.stringify({ p_user: userId, p_limite: Number(env.CLEO_LIMITE_DIA) || 300 }),
  });
  if (!res.ok) throw new Error(`cleo_autoriza_usuario ${res.status}`);
  return (await res.json()) as Autoriza;
}

export async function handle(req: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { erro: 'método' });
  const apikey = req.headers.get('apikey') ?? '';
  const allowed = allowedKeys(env);
  if (!apikey || !(allowed.has(apikey) || isProjectAnonJwt(apikey, env))) {
    // Só impressões digitais nos logs, nunca as chaves.
    console.warn(`chave do app não bate: recebida=${await fingerprint(apikey)} aceitas=${(await Promise.all([...allowed].map(fingerprint))).join(',')}`);
    return json(401, { erro: 'chave do app' });
  }
  // Quem chama é a conta logada: o token da sessão vem no Authorization.
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return json(401, { erro: 'sem login' });
  if (!env.ANTHROPIC_API_KEY) return json(503, { erro: 'sem chave da API' });

  let body: { system?: unknown; messages?: unknown; tools?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(413, { erro: 'conversa grande demais' });
    body = JSON.parse(raw);
  } catch {
    return json(400, { erro: 'JSON inválido' });
  }
  if (typeof body.system !== 'string' || !Array.isArray(body.messages) || body.messages.length === 0) return json(400, { erro: 'faltam system e messages' });
  if (body.messages.length > MAX_MESSAGES) return json(400, { erro: 'conversa longa demais: comece outra' });

  let userId: string;
  try {
    userId = await userIdOf(env, apikey, bearer, fetchFn);
  } catch (e) {
    return json(502, { erro: `conta: ${e instanceof Error ? e.message : String(e)}` });
  }
  if (!userId) return json(401, { erro: 'sem login' });

  let auth: Autoriza;
  try {
    auth = await autoriza(env, userId, fetchFn);
  } catch (e) {
    return json(502, { erro: `autorização: ${e instanceof Error ? e.message : String(e)}` });
  }
  if (!auth.ok) return auth.motivo === 'limite' ? json(429, { erro: 'limite do dia' }) : json(401, { erro: 'sem login' });

  const upstream = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.CLEO_MODEL || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      // O prompt de sistema repete em toda rodada: cache para pagar menos.
      system: [{ type: 'text', text: body.system, cache_control: { type: 'ephemeral' } }],
      tools: Array.isArray(body.tools) ? body.tools : [],
      messages: body.messages,
    }),
  });
  const text = await upstream.text();
  if (!upstream.ok) {
    let detail = '';
    try {
      detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      // sem JSON
    }
    const status = upstream.status === 401 ? 503 : upstream.status === 429 ? 429 : 502;
    return json(status, { erro: status === 503 ? 'chave da API inválida' : `API: ${detail || upstream.status}` });
  }
  const data = JSON.parse(text) as { content: unknown; stop_reason: unknown; usage?: unknown };
  return json(200, { content: data.content, stop_reason: data.stop_reason, usage: data.usage, restantes: auth.restantes });
}
