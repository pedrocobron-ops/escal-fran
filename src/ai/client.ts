// Chamada à função "cleo" na nuvem (Supabase Edge Function), que repassa à API da Anthropic.
// O navegador nunca vê a chave da API: manda o código da escala, e a função confere.
import type { ToolDef } from './tools';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface CleoResponse {
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | string;
}

export interface CleoEndpoint {
  url: string;
  key: string;
  code: string;
}

export class CleoError extends Error {
  constructor(message: string, readonly kind: 'offline' | 'codigo' | 'limite' | 'sem-chave' | 'servidor') {
    super(message);
  }
}

export async function callCleo(ep: CleoEndpoint, body: { system: string; messages: ChatMessage[]; tools: ToolDef[] }, signal?: AbortSignal, fetchFn: typeof fetch = fetch): Promise<CleoResponse> {
  let res: Response;
  try {
    res = await fetchFn(`${ep.url.replace(/\/$/, '')}/functions/v1/cleo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ep.key, Authorization: `Bearer ${ep.key}` },
      body: JSON.stringify({ codigo: ep.code, ...body }),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new CleoError('Sem conexão com a nuvem. Confira a internet e tente de novo.', 'offline');
  }
  if (res.ok) return (await res.json()) as CleoResponse;
  let detail = '';
  try {
    const j = (await res.json()) as { erro?: string; error?: unknown };
    detail = j.erro ?? (typeof j.error === 'string' ? j.error : '');
  } catch {
    // corpo sem JSON
  }
  if (res.status === 403) throw new CleoError('A nuvem não reconheceu o código da escala. Confira em Ajustes, em Sincronizar entre aparelhos.', 'codigo');
  if (res.status === 429) throw new CleoError('A Cléo atingiu o limite de conversas de hoje. Amanhã volta ao normal.', 'limite');
  if (res.status === 503) throw new CleoError('A Cléo ainda não foi ativada na nuvem (falta a chave da API). Fale com quem cuida do app.', 'sem-chave');
  throw new CleoError(`A Cléo não conseguiu responder agora${detail ? ` (${detail})` : ''}. Tente de novo em instantes.`, 'servidor');
}
