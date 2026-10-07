// Cléo, a assistente: resolução de nomes e datas, ferramentas em cima da escala,
// laço da conversa e a função da nuvem (com fetch simulado).
import { describe, expect, it, vi } from 'vitest';
import type { AppData } from '../src/domain';
import { effectiveDay } from '../src/domain';
import { findAsb, findDentist, findRoom, parseHour, parseHours, resolveDate } from '../src/ai/resolve';
import { TOOLS, describeDay, runTool, type ToolContext } from '../src/ai/tools';
import { runTurn, trimHistory } from '../src/ai/agent';
import { systemPrompt } from '../src/ai/context';
import { CleoError, callCleo, type ChatMessage, type CleoResponse } from '../src/ai/client';
import { DEFAULT_MODEL, handle } from '../supabase/functions/cleo/handler';
import { seedData } from '../src/store/storage';
import { ID } from './helpers';

const TODAY = '2026-10-07'; // quarta

function ctxFor(initial: AppData = seedData()): ToolContext & { history: AppData[] } {
  let data = initial;
  const history: AppData[] = [];
  return {
    history,
    data: () => data,
    apply: (m) => {
      history.push(data);
      const next = structuredClone(data);
      m(next);
      data = next;
    },
    undo: () => {
      const prev = history.pop();
      if (!prev) return false;
      data = prev;
      return true;
    },
    today: TODAY,
  };
}

describe('Cléo: nomes, datas e horas', () => {
  const d = seedData();
  it('acha ASB por nome, prefixo e sem acento', () => {
    expect(findAsb(d, 'Pâmela')).toMatchObject({ ok: true, item: { id: ID.pamela } });
    expect(findAsb(d, 'pamela')).toMatchObject({ ok: true, item: { id: ID.pamela } });
    expect(findAsb(d, 'Nic')).toMatchObject({ ok: true, item: { id: ID.nicelia } });
    expect(findAsb(d, 'Zuleide').ok).toBe(false);
    expect(findAsb(d, 'A').ok).toBe(false); // ambíguo: Andrea, Amanda, Ana
  });
  it('acha dentista com ou sem "Dr." e sala por número', () => {
    expect(findDentist(d, 'Francisco')).toMatchObject({ ok: true, item: { id: ID.francisco } });
    expect(findDentist(d, 'dr. francisco')).toMatchObject({ ok: true, item: { id: ID.francisco } });
    expect(findRoom(d, '2')).toMatchObject({ ok: true, item: { id: 's2' } });
    expect(findRoom(d, 'Sala 3')).toMatchObject({ ok: true, item: { id: 's3' } });
  });
  it('datas relativas contam a partir de hoje', () => {
    expect(resolveDate('2026-10-13', TODAY)).toBe('2026-10-13');
    expect(resolveDate('hoje', TODAY)).toBe(TODAY);
    expect(resolveDate('amanhã', TODAY)).toBe('2026-10-08');
    expect(resolveDate('sexta', TODAY)).toBe('2026-10-09');
    expect(resolveDate('segunda-feira', TODAY)).toBe('2026-10-12');
    expect(resolveDate('quarta', TODAY)).toBe(TODAY);
    expect(resolveDate('próxima quarta', TODAY)).toBe('2026-10-14');
    expect(resolveDate('13/10', TODAY)).toBe('2026-10-13');
    expect(resolveDate('13/10/2026', TODAY)).toBe('2026-10-13');
    expect(resolveDate('depois', TODAY)).toBeUndefined();
  });
  it('horas em vários formatos', () => {
    expect(parseHour(7)).toBe(7);
    expect(parseHour('07h')).toBe(7);
    expect(parseHour('16:00')).toBe(16);
    expect(parseHours([15, 16])).toEqual([15, 16]);
    expect(parseHours('15h às 17h')).toEqual([15, 16]);
    expect(parseHours('15, 16')).toEqual([15, 16]);
  });
});

describe('Cléo: ferramentas de consulta', () => {
  it('consultar_dia descreve salas, dentistas, ASBs e alertas', () => {
    const text = describeDay(seedData(), '2026-10-13');
    expect(text).toContain('Terça, 13/10/2026');
    expect(text).toContain('07h: Sala 3 (Dra. Victoria): Andrea');
    expect(text).toContain('CME: Laura');
    expect(text).toContain('Sala 2 (Dr. Edson)');
    expect(text).toContain('SEM ASB');
    expect(text).toContain('[critico]');
  });
  it('consultar_semana e consultar_equipe', () => {
    const ctx = ctxFor();
    const week = runTool('consultar_semana', { data: 'segunda' }, ctx).text;
    expect(week).toContain('Semana de 12/10/2026 a 16/10/2026');
    expect(week.split('\n').length).toBe(6);
    const team = runTool('consultar_equipe', {}, ctx).text;
    expect(team).toContain('Amanda 09h–18h');
    expect(team).toContain('Dr. Francisco (Estomatologia) Sala 1 08h–11h');
  });
  it('consultar_tarefas mostra a planilha de prótese', () => {
    const text = runTool('consultar_tarefas', { data: '2026-10-20' }, ctxFor()).text;
    expect(text).toMatch(/Planilha de prótese \(manhã\): Pâmela/);
    expect(text).toMatch(/Planilha de prótese \(tarde\): Nicélia/);
  });
  it('data que não entende vira ERRO, não exceção', () => {
    expect(runTool('consultar_dia', { data: 'sei lá' }, ctxFor()).text).toMatch(/^ERRO/);
    expect(runTool('inexistente', {}, ctxFor()).text).toMatch(/^ERRO/);
  });
});

describe('Cléo: ferramentas que mudam a escala', () => {
  it('cadastra ausência com sugestão de cobertura e com substituta', () => {
    const ctx = ctxFor();
    const r = runTool('cadastrar_ausencia', { asb: 'Laura', de: 'sexta', motivo: 'Falta' }, ctx);
    expect(r.changed).toBe(true);
    expect(r.text).toContain('Laura ausente 09/10/2026 (Falta)');
    expect(r.text).toMatch(/Fica descoberto|Nada fica descoberto/);
    expect(ctx.data().absences.some((a) => a.asbId === ID.laura && a.from === '2026-10-09')).toBe(true);
    // de novo no mesmo dia: erro de sobreposição
    expect(runTool('cadastrar_ausencia', { asb: 'Laura', de: '2026-10-09' }, ctx).text).toMatch(/^ERRO.*já tem ausência/);
    const r2 = runTool('cadastrar_ausencia', { asb: 'Andrea', de: '2026-10-12', ate: '2026-10-13', motivo: 'Férias', substituta: 'Pâmela' }, ctx);
    expect(r2.text).toContain('Pâmela cobre');
    const day = effectiveDay(ctx.data(), '2026-10-12');
    expect(day.slots.some((s) => s.who.type === 'asb' && s.who.asbId === ID.andrea)).toBe(false);
    const r3 = runTool('cadastrar_ausencia', { asb: 'Ana', de: '2026-10-14', substituta: 'externa: Joana' }, ctx);
    expect(r3.text).toContain('Joana (externa) cobre');
  });

  it('remover pede confirmação antes', () => {
    const ctx = ctxFor();
    runTool('cadastrar_ausencia', { asb: 'Laura', de: '2026-10-09' }, ctx);
    const ask = runTool('remover_ausencia', { asb: 'Laura', data: '2026-10-09' }, ctx);
    expect(ask.text).toMatch(/^PRECISA CONFIRMAR/);
    expect(ask.changed).toBeUndefined();
    expect(ctx.data().absences.length).toBe(1);
    const done = runTool('remover_ausencia', { asb: 'Laura', data: '2026-10-09', confirmado: true }, ctx);
    expect(done.changed).toBe(true);
    expect(ctx.data().absences.length).toBe(0);
  });

  it('hora extra só fora do contrato; troca de horário muda o dia', () => {
    const ctx = ctxFor();
    expect(runTool('cadastrar_hora_extra', { asb: 'Amanda', data: '2026-10-13', inicio: 10, fim: 12 }, ctx).text).toMatch(/^ERRO.*dentro do contrato/);
    const r = runTool('cadastrar_hora_extra', { asb: 'Amanda', data: '2026-10-13', inicio: 7, fim: 10 }, ctx);
    expect(r.text).toContain('07h–09h');
    expect(ctx.data().extraShifts?.[0]).toMatchObject({ asbId: ID.amanda, start: 7, end: 9 });
    const t = runTool('cadastrar_troca_horario', { asb: 'Amanda', de: '2026-10-14', entra: 7, sai: 16, obs: 'médico' }, ctx);
    expect(t.text).toContain('Amanda trabalha 07h–16h 14/10/2026');
    expect(ctx.data().shiftChanges?.[0]).toMatchObject({ asbId: ID.amanda, start: 7, end: 16, note: 'médico' });
    expect(runTool('cadastrar_troca_horario', { asb: 'Amanda', de: '2026-10-14', entra: 8, sai: 17 }, ctx).text).toMatch(/^ERRO.*já tem troca/);
    expect(runTool('cadastrar_troca_horario', { asb: 'Amanda', de: '2026-10-15', entra: 9, sai: 18 }, ctx).text).toMatch(/^ERRO.*horário normal/);
    // no dia trocado ela pode ir para as 07h
    const put = runTool('colocar_no_quadro', { asb: 'Amanda', data: '2026-10-14', horas: [7, 8], destino: 'sala', sala: '2', escopo: 'dia' }, ctx);
    expect(put.changed).toBe(true);
    const day = effectiveDay(ctx.data(), '2026-10-14');
    expect(day.slots.filter((s) => s.hour === 7 && s.who.type === 'asb' && s.who.asbId === ID.amanda).map((s) => `${s.kind}:${s.roomId}`)).toEqual(['sala:s2']);
  });

  it('colocar_no_quadro: semana por padrão, apoio em sala ocupada, fora do contrato é erro', () => {
    const ctx = ctxFor();
    // Andrea 08h Sala 3 -> Sala 1 na semana de 12/10 (Laura é a ASB da Sala 1 às 08h: vira apoio)
    const r = runTool('colocar_no_quadro', { asb: 'Andrea', data: '2026-10-13', horas: [8], destino: 'sala', sala: 'Sala 1' }, ctx);
    expect(r.text).toContain('semana inteira');
    expect(r.text).toContain('08h apoio da sala');
    for (const date of ['2026-10-12', '2026-10-16']) {
      const day = effectiveDay(ctx.data(), date);
      const mine = day.slots.filter((s) => s.hour === 8 && s.who.type === 'asb' && s.who.asbId === ID.andrea).map((s) => `${s.kind}:${s.roomId}`);
      expect(mine).toEqual(['apoio:s1']);
    }
    // semana seguinte continua base
    expect(effectiveDay(ctx.data(), '2026-10-19').slots.filter((s) => s.hour === 8 && s.who.type === 'asb' && s.who.asbId === ID.andrea).map((s) => s.roomId)).toEqual(['s3']);
    // sala livre vira ASB da sala
    const r2 = runTool('colocar_no_quadro', { asb: 'Andrea', data: '2026-10-13', horas: [7], destino: 'sala', sala: '2' }, ctx);
    expect(r2.text).toContain('07h ASB da sala');
    // fora do contrato
    expect(runTool('colocar_no_quadro', { asb: 'Andrea', data: '2026-10-13', horas: [15], destino: 'cme' }, ctx).text).toMatch(/^ERRO.*não trabalha às 15h/);
    // base
    const r3 = runTool('colocar_no_quadro', { asb: 'Laura', data: '2026-10-13', horas: [7], destino: 'almox', escopo: 'base' }, ctx);
    expect(r3.text).toContain('escala base');
    expect(ctx.data().base.slots.filter((s) => s.asbId === ID.laura && s.hour === 7).map((s) => s.kind)).toEqual(['almox']);
  });

  it('tirar_do_quadro, limpar_ajustes com confirmação e desfazer', () => {
    const ctx = ctxFor();
    runTool('colocar_no_quadro', { asb: 'Andrea', data: '2026-10-13', horas: [8], destino: 'sala', sala: '1' }, ctx);
    const r = runTool('tirar_do_quadro', { asb: 'Andrea', data: '2026-10-13', horas: [8] }, ctx);
    expect(r.changed).toBe(true);
    expect(effectiveDay(ctx.data(), '2026-10-13').slots.some((s) => s.hour === 8 && s.who.type === 'asb' && s.who.asbId === ID.andrea)).toBe(false);
    expect(runTool('limpar_ajustes', { data: '2026-10-13', escopo: 'semana' }, ctx).text).toMatch(/^PRECISA CONFIRMAR/);
    runTool('limpar_ajustes', { data: '2026-10-13', escopo: 'semana', confirmado: true }, ctx);
    expect(ctx.data().weekOverrides ?? []).toEqual([]);
    expect(runTool('desfazer', {}, ctx).changed).toBe(true);
    expect((ctx.data().weekOverrides ?? []).length).toBeGreaterThan(0);
  });

  it('folga de dentista, responsável fixo e dia fechado', () => {
    const ctx = ctxFor();
    const r = runTool('cadastrar_folga_dentista', { dentista: 'Edson', de: '2026-10-13' }, ctx);
    expect(r.text).toContain('Dr. Edson de folga 13/10/2026');
    expect(runTool('fixar_responsavel', { tarefa: 'prótese (manhã)', asb: 'Laura', de: '2026-11-01', ate: '2026-11-30' }, ctx).text).toContain('Laura fica fixa');
    expect(runTool('consultar_tarefas', { data: '2026-11-10' }, ctx).text).toMatch(/Planilha de prótese \(manhã\): Laura/);
    expect(runTool('fixar_responsavel', { tarefa: 'prótese (manhã)', asb: 'Ana', de: '2026-11-15', ate: '2026-11-20' }, ctx).text).toMatch(/^ERRO.*já tem responsável/);
    expect(runTool('fechar_dia', { data: '2026-10-12', motivo: 'Feriado' }, ctx).changed).toBe(true);
    expect(effectiveDay(ctx.data(), '2026-10-12').open).toBe(false);
    expect(runTool('reabrir_dia', { data: '2026-10-12' }, ctx).changed).toBe(true);
    expect(effectiveDay(ctx.data(), '2026-10-12').open).toBe(true);
  });

  it('toda ferramenta tem schema válido e nome único', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(t.input_schema.type).toBe('object');
      for (const r of t.input_schema.required ?? []) expect(t.input_schema.properties).toHaveProperty(r);
    }
  });

  it('prompt de sistema traz a data de hoje e a equipe', () => {
    const p = systemPrompt(seedData(), TODAY);
    expect(p).toContain('Hoje é quarta, 07/10/2026');
    expect(p).toContain('Semana atual: 2026-10-05');
    expect(p).toContain('Amanda 09h–18h');
  });
});

describe('Cléo: laço da conversa', () => {
  it('executa a ferramenta pedida e devolve o resultado até a resposta final', async () => {
    const ctx = ctxFor();
    const calls: ChatMessage[][] = [];
    const send = vi.fn(async (messages: ChatMessage[]): Promise<CleoResponse> => {
      calls.push(structuredClone(messages));
      if (calls.length === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'cadastrar_ausencia', input: { asb: 'Laura', de: '2026-10-09' } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Pronto, Laura de folga na sexta.' }] };
    });
    const events: string[] = [];
    const r = await runTurn([], 'a Laura vai faltar sexta', ctx, send, (e) => events.push(e.name));
    expect(r.text).toBe('Pronto, Laura de folga na sexta.');
    expect(r.changed).toBe(true);
    expect(events).toEqual(['cadastrar_ausencia']);
    expect(ctx.data().absences.length).toBe(1);
    // segunda chamada recebe o tool_result
    const second = calls[1];
    expect(second.length).toBe(3);
    const last = second[2];
    expect(last.role).toBe('user');
    expect(Array.isArray(last.content) && last.content[0].type === 'tool_result' && last.content[0].content).toContain('Feito: Laura ausente');
    // histórico completo para a próxima rodada
    expect(r.messages.length).toBe(4);
  });

  it('para no limite de rodadas e trimHistory começa numa pergunta', async () => {
    const ctx = ctxFor();
    const send = vi.fn(async (): Promise<CleoResponse> => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'consultar_equipe', input: {} }] }));
    const r = await runTurn([], 'oi', ctx, send);
    expect(send).toHaveBeenCalledTimes(8);
    expect(r.text).toContain('parei por aqui');
    const trimmed = trimHistory(r.messages, 5);
    expect(trimmed[0].role).toBe('user');
    expect(typeof trimmed[0].content).toBe('string');
    // janela normal: começa na pergunta mais recente que cabe
    const long: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) long.push({ role: 'user', content: `p${i}` }, { role: 'assistant', content: [{ type: 'text', text: 'r' }] });
    const t2 = trimHistory(long, 5);
    expect(t2.length).toBe(4);
    expect(t2[0].content).toBe('p8');
  });
});

describe('Cléo: cliente e função da nuvem', () => {
  const ep = { url: 'https://x.supabase.co', key: 'anon', code: 'ceo-abcd-efgh-ijkl' };
  it('callCleo manda código, chave e corpo; traduz erros', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://x.supabase.co/functions/v1/cleo');
      const body = JSON.parse(String(init?.body));
      expect(body.codigo).toBe(ep.code);
      expect((init?.headers as Record<string, string>).apikey).toBe('anon');
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'oi' }], stop_reason: 'end_turn' }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await callCleo(ep, { system: 's', messages: [{ role: 'user', content: 'oi' }], tools: [] }, undefined, fetchFn);
    expect(r.stop_reason).toBe('end_turn');
    const err = async (status: number) => {
      const f = (async () => new Response(JSON.stringify({ erro: 'x' }), { status })) as unknown as typeof fetch;
      return callCleo(ep, { system: 's', messages: [], tools: [] }, undefined, f).catch((e: CleoError) => e.kind);
    };
    expect(await err(403)).toBe('codigo');
    expect(await err(429)).toBe('limite');
    expect(await err(503)).toBe('sem-chave');
    expect(await err(500)).toBe('servidor');
    const offline = (async () => { throw new TypeError('fail'); }) as unknown as typeof fetch;
    await expect(callCleo(ep, { system: 's', messages: [], tools: [] }, undefined, offline)).rejects.toMatchObject({ kind: 'offline' });
  });

  const env = { ANTHROPIC_API_KEY: 'sk-test', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
  const post = (body: unknown, apikey = 'anon') => new Request('https://x.supabase.co/functions/v1/cleo', { method: 'POST', headers: { apikey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const good = { codigo: 'ceo-abcd-efgh-ijkl', system: 'sys', messages: [{ role: 'user', content: 'oi' }], tools: [{ name: 't' }] };

  function cloud(opts: { auth?: unknown; upstream?: Response } = {}) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes('/rest/v1/rpc/cleo_autoriza')) return new Response(JSON.stringify(opts.auth ?? { ok: true, restantes: 10 }), { status: 200 });
      return opts.upstream ?? new Response(JSON.stringify({ content: [{ type: 'text', text: 'oi' }], stop_reason: 'end_turn', usage: { input_tokens: 1 } }), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  }

  it('OPTIONS responde CORS; chave do app errada é 401; sem chave da API é 503', async () => {
    const opt = await handle(new Request('https://x/', { method: 'OPTIONS' }), env);
    expect(opt.status).toBe(204);
    expect(opt.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await handle(post(good, 'errada'), env)).status).toBe(401);
    expect((await handle(post(good), { ...env, ANTHROPIC_API_KEY: undefined })).status).toBe(503);
  });

  it('código malformado ou desconhecido é 403; limite é 429', async () => {
    expect((await handle(post({ ...good, codigo: 'abc' }), env, cloud().fetchFn)).status).toBe(403);
    expect((await handle(post(good), env, cloud({ auth: { ok: false, motivo: 'codigo' } }).fetchFn)).status).toBe(403);
    expect((await handle(post(good), env, cloud({ auth: { ok: false, motivo: 'limite' } }).fetchFn)).status).toBe(429);
    expect((await handle(post({ ...good, messages: [] }), env, cloud().fetchFn)).status).toBe(400);
  });

  it('repassa à Anthropic com a chave, o modelo e o cache do sistema; nunca devolve a chave', async () => {
    const c = cloud();
    const res = await handle(post(good), env, c.fetchFn);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stop_reason).toBe('end_turn');
    expect(body.restantes).toBe(10);
    expect(JSON.stringify(body)).not.toContain('sk-test');
    const auth = c.calls[0];
    expect(auth.url).toContain('/rest/v1/rpc/cleo_autoriza');
    expect((auth.init.headers as Record<string, string>).apikey).toBe('service');
    expect(JSON.parse(String(auth.init.body))).toEqual({ p_codigo: 'ceo-abcd-efgh-ijkl', p_limite: 300 });
    const up = c.calls[1];
    expect(up.url).toBe('https://api.anthropic.com/v1/messages');
    const h = up.init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-test');
    expect(h['anthropic-version']).toBe('2023-06-01');
    const sent = JSON.parse(String(up.init.body));
    expect(sent.model).toBe(DEFAULT_MODEL);
    expect(sent.system[0]).toEqual({ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } });
    expect(sent.tools).toEqual([{ name: 't' }]);
    expect(sent.messages).toEqual(good.messages);
  });

  it('modelo e limite vêm do ambiente; chave inválida na Anthropic vira 503', async () => {
    const c = cloud();
    await handle(post(good), { ...env, CLEO_MODEL: 'claude-sonnet-5-5', CLEO_LIMITE_DIA: '50' }, c.fetchFn);
    expect(JSON.parse(String(c.calls[0].init.body)).p_limite).toBe(50);
    expect(JSON.parse(String(c.calls[1].init.body)).model).toBe('claude-sonnet-5-5');
    const bad = cloud({ upstream: new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }) });
    const res = await handle(post(good), env, bad.fetchFn);
    expect(res.status).toBe(503);
    const over = cloud({ upstream: new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 529 }) });
    expect((await handle(post(good), env, over.fetchFn)).status).toBe(502);
  });
});
