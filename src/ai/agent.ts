// Laço da conversa: manda a pergunta, executa as ferramentas que a Cléo pedir (aqui no
// navegador) e devolve o resultado até ela responder em texto.
import type { ChatMessage, CleoResponse, ContentBlock } from './client';
import { TOOLS, runTool, type ToolContext } from './tools';

export interface TurnEvent {
  type: 'tool';
  name: string;
  input: Record<string, unknown>;
  text: string;
  changed: boolean;
}

export interface TurnResult {
  /** Texto final da Cléo (vazio se ela só chamou ferramentas e parou). */
  text: string;
  /** Histórico completo para a próxima rodada. */
  messages: ChatMessage[];
  changed: boolean;
}

const MAX_ROUNDS = 8;

export async function runTurn(
  history: ChatMessage[],
  userText: string,
  ctx: ToolContext,
  send: (messages: ChatMessage[]) => Promise<CleoResponse>,
  onEvent?: (e: TurnEvent) => void,
): Promise<TurnResult> {
  const messages: ChatMessage[] = [...history, { role: 'user', content: userText }];
  let changed = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await send(messages);
    messages.push({ role: 'assistant', content: res.content });
    const uses = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || uses.length === 0) {
      return { text: textOf(res.content), messages, changed };
    }
    const results: ContentBlock[] = [];
    for (const u of uses) {
      let out: { text: string; changed?: boolean };
      try {
        out = runTool(u.name, u.input ?? {}, ctx);
      } catch (e) {
        out = { text: `ERRO: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (out.changed) changed = true;
      onEvent?.({ type: 'tool', name: u.name, input: u.input ?? {}, text: out.text, changed: !!out.changed });
      results.push({ type: 'tool_result', tool_use_id: u.id, content: out.text, is_error: out.text.startsWith('ERRO:') || undefined });
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: 'Fiz várias etapas e parei por aqui. Confira o quadro e me diga se falta algo.', messages, changed };
}

export function textOf(content: ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Mantém o histórico curto: as últimas N mensagens, começando sempre numa pergunta da pessoa. */
export function trimHistory(messages: ChatMessage[], keep = 24): ChatMessage[] {
  if (messages.length <= keep) return messages;
  const isQuestion = (m: ChatMessage) => m.role === 'user' && typeof m.content === 'string';
  const min = messages.length - keep;
  let start = messages.findIndex((m, i) => i >= min && isQuestion(m));
  // Sem pergunta dentro da janela: volta até a última antes dela (fica um pouco maior, mas íntegro).
  if (start < 0) {
    start = min;
    while (start > 0 && !isQuestion(messages[start])) start--;
  }
  return messages.slice(start);
}

export { TOOLS };
