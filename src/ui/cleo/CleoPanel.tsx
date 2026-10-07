import { useCallback, useEffect, useRef, useState } from 'react';
import { todayIso } from '../../domain';
import { useStore } from '../../store/useStore';
import { builtInProject, readSyncConfig } from '../../store/sync';
import { href } from '../router';
import { runTurn, trimHistory, TOOLS } from '../../ai/agent';
import { CleoError, callCleo, type ChatMessage } from '../../ai/client';
import { systemPrompt } from '../../ai/context';
import { dictationSupported, speak, speechSupported, startDictation, stopSpeaking } from '../../ai/speech';

type Item = { id: number; kind: 'user' | 'cleo' | 'tool' | 'error' | 'hint'; text: string };

const SESSION_KEY = 'escala-ceo:cleo';
const VOICE_KEY = 'escala-ceo:cleo-voz';
const WELCOME = 'Oi, eu sou a Cléo. Posso contar como está a escala e fazer mudanças por você. Experimente: "quem está na Sala 2 amanhã?", "a Laura vai faltar sexta, quem cobre?", "põe a Amanda na Sala 3 das 15h às 17h" ou "a Andrea troca para 07h às 13h na quinta".';

function readSession(): { items: Item[]; messages: ChatMessage[] } | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as { items: Item[]; messages: ChatMessage[] }) : null;
  } catch {
    return null;
  }
}
function writeSession(items: Item[], messages: ChatMessage[]): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ items: items.slice(-80), messages }));
  } catch {
    // sem sessionStorage: a conversa vale só enquanto a tela está aberta
  }
}
function readVoice(): boolean {
  try {
    return window.localStorage.getItem(VOICE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Botão flutuante e painel de conversa com a Cléo. */
export function CleoPanel() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {!open && (
        <button className="cleo-fab" onClick={() => setOpen(true)} title="Falar com a Cléo" aria-label="Falar com a Cléo">
          <span className="cleo-fab-icon" aria-hidden>✦</span> Cléo
        </button>
      )}
      {open && <Drawer onClose={() => setOpen(false)} />}
    </>
  );
}

function Drawer({ onClose }: { onClose: () => void }) {
  const apply = useStore((s) => s.apply);
  const undo = useStore((s) => s.undo);
  const cfg = readSyncConfig();
  const project = builtInProject();
  const endpoint = cfg && project ? { url: cfg.url || project.url, key: cfg.key || project.key, code: cfg.code } : null;

  const saved = useRef(readSession());
  const [items, setItems] = useState<Item[]>(saved.current?.items ?? [{ id: 0, kind: 'cleo', text: WELCOME }]);
  const messagesRef = useRef<ChatMessage[]>(saved.current?.messages ?? []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState(readVoice);
  const nextId = useRef(items.length + 1);
  const abortRef = useRef<AbortController | null>(null);
  const stopDictation = useRef<() => void>(() => {});
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const push = useCallback((kind: Item['kind'], t: string) => {
    setItems((list) => [...list, { id: nextId.current++, kind, text: t }]);
  }, []);

  useEffect(() => {
    writeSession(items, messagesRef.current);
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items]);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      abortRef.current?.abort();
      stopDictation.current();
      stopSpeaking();
    };
  }, []);

  const toggleVoice = () => {
    setVoice((v) => {
      try {
        window.localStorage.setItem(VOICE_KEY, v ? '0' : '1');
      } catch {
        // vale só nesta abertura
      }
      if (v) stopSpeaking();
      return !v;
    });
  };

  const send = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q || busy || !endpoint) return;
      setText('');
      push('user', q);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const today = todayIso();
      const ctx = {
        data: () => useStore.getState().data!,
        apply,
        undo: () => {
          if (!useStore.getState().canUndo()) return false;
          undo();
          return true;
        },
        today,
      };
      try {
        const result = await runTurn(
          trimHistory(messagesRef.current),
          q,
          ctx,
          (messages) => callCleo(endpoint, { system: systemPrompt(useStore.getState().data!, today), messages, tools: TOOLS }, controller.signal),
          (e) => push('tool', e.text.startsWith('ERRO:') ? e.text.replace(/^ERRO:\s*/, 'Não deu: ') : e.text.startsWith('PRECISA CONFIRMAR') ? 'Vou confirmar antes.' : e.changed ? e.text : `Consultei: ${labelFor(e.name)}.`),
        );
        messagesRef.current = result.messages;
        if (result.text) {
          push('cleo', result.text);
          if (voice) speak(result.text);
        }
        if (result.changed) push('hint', 'Mudou algo que não queria? Use Desfazer, no topo da tela.');
      } catch (e) {
        if (controller.signal.aborted) push('hint', 'Parei.');
        else push('error', e instanceof CleoError ? e.message : 'Algo deu errado. Tente de novo.');
        // Rodada que falhou não entra no histórico: a próxima pergunta começa limpa.
      } finally {
        abortRef.current = null;
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [apply, busy, endpoint, push, undo, voice],
  );

  const toggleDictation = () => {
    if (listening) {
      stopDictation.current();
      return;
    }
    stopSpeaking();
    setListening(true);
    let finalText = '';
    stopDictation.current = startDictation({
      onText: (t, final) => {
        setText(t);
        if (final) finalText = t;
      },
      onError: (msg) => push('error', msg),
      onEnd: () => {
        setListening(false);
        stopDictation.current = () => {};
        if (finalText.trim()) void send(finalText);
      },
    });
  };

  const reset = () => {
    abortRef.current?.abort();
    stopSpeaking();
    messagesRef.current = [];
    nextId.current = 1;
    setItems([{ id: 0, kind: 'cleo', text: WELCOME }]);
  };

  return (
    <div className="cleo-panel" role="dialog" aria-label="Cléo, assistente da escala">
      <div className="cleo-head">
        <div>
          <strong>Cléo</strong> <span className="muted small">assistente da escala</span>
        </div>
        <div className="cleo-head-actions">
          {speechSupported() && (
            <button className={`btn sm${voice ? ' active' : ''}`} onClick={toggleVoice} title={voice ? 'Parar de ler as respostas em voz alta' : 'Ler as respostas em voz alta'} aria-pressed={voice}>
              {voice ? 'Voz ligada' : 'Voz'}
            </button>
          )}
          <button className="btn sm" onClick={reset} title="Começar outra conversa">Nova conversa</button>
          <button className="btn sm" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
      </div>
      {!endpoint ? (
        <div className="cleo-body">
          <p>Para falar com a Cléo, a escala precisa estar na nuvem: ela usa o código da escala para saber que é você.</p>
          <p>
            Vá em <a href={href('ajustes')} onClick={onClose}>Ajustes, Sincronizar entre aparelhos</a>, crie ou entre com o código da escala e volte aqui.
          </p>
        </div>
      ) : (
        <>
          <div className="cleo-body" ref={listRef}>
            {items.map((it) => (
              <div key={it.id} className={`cleo-msg ${it.kind}`}>
                {it.text}
              </div>
            ))}
            {busy && <div className="cleo-msg cleo thinking">Cléo está pensando...</div>}
          </div>
          <form
            className="cleo-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <textarea
              ref={inputRef}
              value={text}
              rows={1}
              placeholder={listening ? 'Ouvindo... fale e eu mando quando você parar.' : 'Pergunte ou peça uma mudança'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
              disabled={busy}
            />
            {dictationSupported() && (
              <button type="button" className={`btn${listening ? ' danger' : ''}`} onClick={toggleDictation} disabled={busy} title={listening ? 'Parar de ouvir' : 'Falar em vez de escrever'} aria-label={listening ? 'Parar de ouvir' : 'Falar'}>
                {listening ? '■' : '🎤'}
              </button>
            )}
            {busy ? (
              <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>Parar</button>
            ) : (
              <button type="submit" className="btn primary" disabled={!text.trim()}>Enviar</button>
            )}
          </form>
        </>
      )}
    </div>
  );
}

function labelFor(tool: string): string {
  const labels: Record<string, string> = {
    consultar_dia: 'a escala do dia',
    consultar_semana: 'a semana',
    consultar_equipe: 'a equipe',
    consultar_ausencias: 'ausências e extras',
    consultar_tarefas: 'as tarefas',
    sugerir_cobertura: 'quem pode cobrir',
  };
  return labels[tool] ?? tool.replace(/_/g, ' ');
}
