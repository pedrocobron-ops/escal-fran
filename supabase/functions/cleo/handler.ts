// Função "cleo": recebe a conversa do app, confere o código da escala e o limite diário,
// e repassa à API da Anthropic com a chave guardada nos segredos do projeto.
// Este arquivo é puro (sem Deno.*) para ser testado com Vitest; index.ts o liga ao Deno.serve.

export interface Env {
  ANTHROPIC_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
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
  motivo?: 'codigo' | 'limite';
  restantes?: number;
}

/** Confere o código e conta a chamada do dia (função SQL public.cleo_autoriza, só com service role). */
async function autoriza(env: Env, codigo: string, fetchFn: typeof fetch): Promise<Autoriza> {
  const res = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/cleo_autoriza`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
    },
    body: JSON.stringify({ p_codigo: codigo, p_limite: Number(env.CLEO_LIMITE_DIA) || 300 }),
  });
  if (!res.ok) throw new Error(`cleo_autoriza ${res.status}`);
  return (await res.json()) as Autoriza;
}

export async function handle(req: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { erro: 'método' });
  const apikey = req.headers.get('apikey') ?? (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!env.SUPABASE_ANON_KEY || apikey !== env.SUPABASE_ANON_KEY) return json(401, { erro: 'chave do app' });
  if (!env.ANTHROPIC_API_KEY) return json(503, { erro: 'sem chave da API' });

  let body: { codigo?: unknown; system?: unknown; messages?: unknown; tools?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(413, { erro: 'conversa grande demais' });
    body = JSON.parse(raw);
  } catch {
    return json(400, { erro: 'JSON inválido' });
  }
  const codigo = typeof body.codigo === 'string' ? body.codigo.trim().toLowerCase() : '';
  if (!/^ceo-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(codigo)) return json(403, { erro: 'código' });
  if (typeof body.system !== 'string' || !Array.isArray(body.messages) || body.messages.length === 0) return json(400, { erro: 'faltam system e messages' });
  if (body.messages.length > MAX_MESSAGES) return json(400, { erro: 'conversa longa demais: comece outra' });

  let auth: Autoriza;
  try {
    auth = await autoriza(env, codigo, fetchFn);
  } catch (e) {
    return json(502, { erro: `autorização: ${e instanceof Error ? e.message : String(e)}` });
  }
  if (!auth.ok) return auth.motivo === 'limite' ? json(429, { erro: 'limite do dia' }) : json(403, { erro: 'código' });

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
