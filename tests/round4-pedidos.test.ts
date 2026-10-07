// Pedidos do cliente de 07/10/2026 (áudio): escala da semana, apoio automático,
// almoço 12h–15h, responsável fixo por período, PDF sem alertas, sincronização.
import { describe, expect, it, vi } from 'vitest';
import type { AppData } from '../src/domain';
import { DEFAULT_LUNCH_WINDOW, analyze, canLunchAt, effectiveDay, lunchWindowOf, resolveTask } from '../src/domain';
import { baseEntriesAt, clearSchedule } from '../src/store/useStore';
import { MemoryAdapter, parseBackup, repairBackup } from '../src/store/storage';
import { SupabaseRemote, SyncedAdapter, newSyncCode, normalizeCode, type SyncStatus } from '../src/store/sync';
import { keptAt, placeInBase, roomDropKind } from '../src/ui/board/placement';
import { dayPdfModel, describeTaskHolder, monthPdfModel } from '../src/pdf/model';
import { ID, absence, seed } from './helpers';

const rooms = (d: AppData, asbId: string, hour: number) => baseEntriesAt(d, asbId, hour).map((e) => `${e.kind}:${e.roomId ?? ''}`).sort();

describe('pedido 6: duas por célula, apoio automático', () => {
  it('regra: sala livre e ASB livre vira ASB da sala; senão apoio', () => {
    expect(roomDropKind(false, false)).toBe('sala');
    expect(roomDropKind(true, false)).toBe('apoio');
    expect(roomDropKind(false, true)).toBe('apoio');
  });

  it('da Sala 3 jogada na Sala 4 entra como apoio e continua na Sala 3', () => {
    const d = seed();
    // Andrea 08h: Sala 3. Solta da paleta na Sala 4 (Pâmela já é a ASB).
    placeInBase(d, { asbId: ID.andrea, hours: [8], target: { kind: 'apoio', roomId: 's4' }, mode: 'add' });
    expect(rooms(d, ID.andrea, 8)).toEqual(['apoio:s4', 'sala:s3']);
    const day = effectiveDay(d, '2026-10-07');
    const al = analyze(d, day);
    expect(al.find((a) => a.code === 'asb-duas-salas' && a.hour === 8)?.level).toBe('info');
    expect(al.some((a) => a.code === 'duas-asbs-mesma-sala' && a.hour === 8)).toBe(false);
  });

  it('quem está de apoio conta como presença: a sala não fica sem ASB', () => {
    const d = seed();
    clearSchedule(d);
    placeInBase(d, { asbId: ID.laura, hours: [8], target: { kind: 'apoio', roomId: 's1' }, mode: 'add' });
    const day = effectiveDay(d, '2026-10-07');
    expect(analyze(d, day).some((a) => a.code === 'sala-sem-asb' && a.roomId === 's1' && a.hour === 8)).toBe(false);
    const row = dayPdfModel(d, '2026-10-07').rows[1];
    expect(row.cells[0].asb).toBe('ASB: Laura (apoio)');
    // e o app não coloca mais ninguém lá
    expect(day.slots.filter((s) => s.roomId === 's1' && s.hour === 8)).toHaveLength(1);
  });

  it('da lista acrescenta sem tirar de onde está (inclusive almoxarifado e apoio geral)', () => {
    const d = seed();
    // Amanda 09h: almoxarifado. Da lista para a Sala 1 (Laura lá): apoio e continua no almoxarifado.
    placeInBase(d, { asbId: ID.amanda, hours: [9], target: { kind: 'apoio', roomId: 's1' }, mode: 'add' });
    expect(rooms(d, ID.amanda, 9)).toEqual(['almox:', 'apoio:s1']);
    // Coluna de apoio: sai de tudo o que fazia nessa hora.
    placeInBase(d, { asbId: ID.amanda, hours: [9], target: { kind: 'cme' }, mode: 'replace' });
    expect(rooms(d, ID.amanda, 9)).toEqual(['cme:']);
    expect(keptAt({ asbId: ID.laura, hours: [10], target: { kind: 'sala', roomId: 's3' }, mode: 'move', orig: { hour: 10, kind: 'sala', roomId: 's1' } }, 10, [{ kind: 'sala', roomId: 's1' }, { kind: 'almoco' }])).toEqual([{ kind: 'almoco' }]);
  });

  it('faixa com ficha do quadro: move em todas as horas, sem perder a primeira', () => {
    const d = seed();
    // Laura: Sala 1 08h–10h. Move a faixa 08h–11h para a Sala 2 (livre às 08h).
    placeInBase(d, { asbId: ID.laura, hours: [8, 9, 10], target: { kind: 'sala', roomId: 's2' }, mode: 'move', orig: { hour: 8, kind: 'sala', roomId: 's1' } });
    expect([8, 9, 10].map((h) => rooms(d, ID.laura, h))).toEqual([['sala:s2'], ['sala:s2'], ['sala:s2']]);
  });
});

describe('pedido 7: almoço entre 12h e 15h', () => {
  it('janela padrão e alerta para almoço fora dela', () => {
    const d = seed();
    expect(lunchWindowOf(d)).toEqual(DEFAULT_LUNCH_WINDOW);
    expect(canLunchAt(d, 11)).toBe(false);
    expect(canLunchAt(d, 12)).toBe(true);
    expect(canLunchAt(d, 14)).toBe(true);
    expect(canLunchAt(d, 15)).toBe(false);
    d.base.slots.push({ asbId: ID.pamela, hour: 11, kind: 'almoco' });
    const al = analyze(d, effectiveDay(d, '2026-10-07'));
    expect(al.find((a) => a.code === 'almoco-fora-do-horario')?.message).toContain('Pâmela está com almoço às 11h');
    expect(al.some((a) => a.code === 'sem-almoco' && a.asbId === ID.pamela)).toBe(false);
  });

  it('escala inicial: o almoço das 11h não existe e o app cobra o da Pâmela', () => {
    const d = seed();
    expect(d.base.slots.some((s) => s.kind === 'almoco' && s.hour === 11)).toBe(false);
    const lunches = d.base.slots.filter((s) => s.kind === 'almoco').map((s) => s.hour).sort();
    expect(lunches).toEqual([12, 12, 13, 14]);
    const al = analyze(d, effectiveDay(d, '2026-10-07'));
    expect(al.filter((a) => a.level === 'critico').map((a) => a.code).sort()).toEqual(['sala-sem-asb', 'sem-almoco']);
  });

  it('janela configurada entra no backup e no histórico', () => {
    const d = seed();
    d.lunchWindow = { start: 13, end: 15 };
    expect(canLunchAt(parseBackup(JSON.stringify(d)), 12)).toBe(false);
    (d as unknown as { lunchWindow: unknown }).lunchWindow = { start: 15, end: 12 };
    expect(() => parseBackup(JSON.stringify(d))).toThrow(/almoço/);
    expect(repairBackup(JSON.stringify(d)).data.lunchWindow).toBeUndefined();
  });
});

describe('pedido 5: alguém fixa na tarefa o mês inteiro', () => {
  it('a responsável fixa vale acima da regra, e a ausência devolve a regra', () => {
    const d = seed();
    const task = d.tasks.find((t) => t.name.startsWith('Conferência de prótese (11h'))!;
    task.holdersByPeriod = [{ id: 'fx1', asbId: ID.nicelia, from: '2026-10-01', to: '2026-10-31' }];
    const r = resolveTask(d, task, '2026-10-07');
    expect(r.holders).toEqual([{ type: 'asb', asbId: ID.nicelia }]);
    expect(r.reason).toBe('Nicélia fica fixa nesta tarefa de 01/10/2026 a 31/10/2026.');
    expect(resolveTask(d, task, '2026-11-03').holders).not.toEqual([{ type: 'asb', asbId: ID.nicelia }]);
    d.absences.push(absence({ asbId: ID.nicelia, from: '2026-10-08', to: '2026-10-08' }));
    const r2 = resolveTask(d, task, '2026-10-08');
    expect(r2.reason).toMatch(/^Nicélia \(fixa de 01\/10\/2026 a 31\/10\/2026\) está ausente\. Na Sala 1 com Dra\. Priscila/);
  });

  it('aparece escrita na planilha do mês', () => {
    const d = seed();
    const task = d.tasks.find((t) => t.name.startsWith('Conferência de prótese (11h'))!;
    task.holdersByPeriod = [{ id: 'fx1', asbId: ID.laura, from: '2026-10-01', to: '2026-10-31' }];
    expect(describeTaskHolder(d, task, '2026-10-01', '2026-10-31')).toBe('Laura (o mês inteiro). Fora desse período: quem estiver na Sala 1 com Dra. Priscila (11h–15h)');
    expect(describeTaskHolder(d, task, '2026-11-01', '2026-11-30')).toBe('quem estiver na Sala 1 com Dra. Priscila (11h–15h)');
    const m = monthPdfModel(d, 2026, 10);
    expect(m.taskRows.find((r) => r.task === task.name)?.who).toContain('Laura (o mês inteiro)');
    task.holdersByPeriod = [{ id: 'fx1', asbId: ID.laura, from: '2026-10-01', to: '2026-10-31' }, { id: 'bad', asbId: ID.laura, from: '2026-10-05', to: '2026-10-01' }];
    expect(() => parseBackup(JSON.stringify(d))).toThrow(/responsável fixo/);
    expect(repairBackup(JSON.stringify(d)).data.tasks.find((t) => t.id === task.id)?.holdersByPeriod).toHaveLength(1);
  });
});

describe('pedidos 1 e 8: ficha só com o nome e PDF sem alertas', () => {
  it('o PDF do dia não tem lista de alertas e o quadro marca só a hora extra', () => {
    const d = seed();
    d.extraShifts = [{ id: 'x', asbId: ID.andrea, date: '2026-10-07', start: 13, end: 14 }];
    d.dayOverrides = [{ id: 'o', date: '2026-10-07', asbId: ID.andrea, hour: 13, kind: 'sala', roomId: 's2' }];
    const m = dayPdfModel(d, '2026-10-07');
    expect('alerts' in m).toBe(false);
    const cell = m.rows[6].cells[1].asb; // 13h, Sala 2
    expect(cell).toContain('Andrea (extra)');
    expect(cell).not.toContain('ajuste');
  });
});

describe('pedido 3: sincronização pela nuvem', () => {
  function fakeCloud() {
    const rows = new Map<string, { data: unknown; updated_at: string }>();
    let tick = 0;
    const calls: string[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      const name = url.split('/rpc/')[1];
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const code = String(body.p_codigo);
      calls.push(name);
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (name === 'escala_get') { const r = rows.get(code); return json(r ? [r] : []); }
      if (name === 'escala_version') return json(rows.get(code)?.updated_at ?? null);
      if (name === 'escala_put') { tick++; const at = `2026-10-07T10:00:${String(tick).padStart(2, '0')}Z`; rows.set(code, { data: body.p_data, updated_at: at }); return json(at); }
      return new Response('{"message":"no"}', { status: 404 });
    };
    return { rows, calls, fetchFn };
  }
  const flush = () => new Promise((r) => setTimeout(r, 20));

  it('primeiro aparelho sobe a escala; segundo aparelho recebe a mesma; mudança num aparece no outro', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const cloud = fakeCloud();
    const cfg = { url: 'https://x.supabase.co', key: 'k', code: 'ceo-test-code-1' };
    const statuses: SyncStatus[] = [];
    const storeA = new Map<string, string>();
    const lsA = { getItem: (k: string) => storeA.get(k) ?? null, setItem: (k: string, v: string) => void storeA.set(k, v), removeItem: (k: string) => void storeA.delete(k), key: () => null, length: 0, clear: () => storeA.clear() } as unknown as Storage;
    const localA = new MemoryAdapter();
    localA.raw = JSON.stringify(seed());
    const a = new SyncedAdapter(localA, new SupabaseRemote(cfg, cloud.fetchFn), lsA, (s) => statuses.push(s), () => true);
    const la = await a.load();
    expect(la.status).toBe('ok');
    await vi.advanceTimersByTimeAsync(50);
    expect(cloud.rows.has(cfg.code)).toBe(true);

    // segundo aparelho, vazio
    const storeB = new Map<string, string>();
    const lsB = { getItem: (k: string) => storeB.get(k) ?? null, setItem: (k: string, v: string) => void storeB.set(k, v), removeItem: (k: string) => void storeB.delete(k), key: () => null, length: 0, clear: () => storeB.clear() } as unknown as Storage;
    const localB = new MemoryAdapter();
    const b = new SyncedAdapter(localB, new SupabaseRemote(cfg, cloud.fetchFn), lsB, () => undefined, () => true);
    const lb = await b.load();
    expect(lb.status).toBe('ok');
    expect(lb.status === 'ok' && lb.data.asbs.length).toBe(7);

    // A muda e envia; B confere e recebe
    const changed = seed();
    changed.rules = ['REGRA NOVA'];
    await a.save(changed);
    await vi.advanceTimersByTimeAsync(2000);
    expect((cloud.rows.get(cfg.code)!.data as AppData).rules).toEqual(['REGRA NOVA']);
    let received: AppData | null = null;
    await b.check((d) => { received = d; });
    expect(received!.rules).toEqual(['REGRA NOVA']);
    expect(JSON.parse(localB.raw!).rules).toEqual(['REGRA NOVA']);
    expect(statuses.some((s) => s.state === 'ok')).toBe(true);
    vi.useRealTimers();
    await flush();
  });

  it('sem conexão: usa a cópia local, avisa e envia depois', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let online = false;
    const cloud = fakeCloud();
    const fetchFn = async (url: string, init?: RequestInit) => { if (!online) throw new TypeError('Failed to fetch'); return cloud.fetchFn(url, init); };
    const cfg = { url: 'https://x.supabase.co', key: 'k', code: 'ceo-test-code-2' };
    const statuses: SyncStatus[] = [];
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), key: () => null, length: 0, clear: () => store.clear() } as unknown as Storage;
    const local = new MemoryAdapter();
    local.raw = JSON.stringify(seed());
    const a = new SyncedAdapter(local, new SupabaseRemote(cfg, fetchFn), ls, (s) => statuses.push(s), () => true);
    const r = await a.load();
    expect(r.status).toBe('ok');
    expect(statuses.at(-1)).toEqual({ state: 'offline', error: 'Sem conexão com a nuvem.' });
    const changed = seed();
    changed.rules = ['OFFLINE'];
    await a.save(changed);
    await vi.advanceTimersByTimeAsync(2000);
    expect(cloud.rows.size).toBe(0);
    expect(JSON.parse(store.get('escala-ceo:sync-meta')!).dirty).toBe(true);
    online = true;
    await a.check(() => undefined); // dirty: envia o local
    await vi.advanceTimersByTimeAsync(100);
    expect((cloud.rows.get(cfg.code)!.data as AppData).rules).toEqual(['OFFLINE']);
    expect(JSON.parse(store.get('escala-ceo:sync-meta')!).dirty).toBe(false);
    vi.useRealTimers();
    await flush();
  });

  it('código novo é legível e a chave do projeto errada dá mensagem clara', async () => {
    expect(newSyncCode()).toMatch(/^ceo-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(normalizeCode('  CEO-ABCD-EFGH-JKLM ')).toBe('ceo-abcd-efgh-jklm');
    const remote = new SupabaseRemote({ url: 'https://x.supabase.co/', key: 'bad', code: 'ceo-aaaa-bbbb-cccc' }, async () => new Response('{"message":"Invalid API key"}', { status: 401 }));
    await expect(remote.get()).rejects.toThrow(/recusou a chave/);
  });
});

describe('projeto da nuvem no código', () => {
  it('o app já sabe o projeto clientes-basicos e aceita trocar por variáveis de build', async () => {
    const { builtInProject } = await import('../src/store/sync');
    const p = builtInProject();
    expect(p?.url).toBe('https://pifuiczrytmizqxzygbi.supabase.co');
    expect(p?.key.startsWith('eyJ')).toBe(true);
  });
});

describe('correções da rodada de testes de 07/10', () => {
  it('histórico: definir o horário de almoço hoje não muda os dias passados', async () => {
    const { recordHistory, dataForDate } = await import('../src/domain');
    const d0 = seed();
    d0.historySince = '2026-09-01';
    const d1 = structuredClone(d0);
    d1.lunchWindow = { start: 13, end: 15 };
    d1.history = recordHistory(d0, d1, '2026-10-07');
    const again = JSON.parse(JSON.stringify(d1)) as AppData; // como fica depois de salvar
    expect(canLunchAt(dataForDate(again, '2026-10-06'), 12)).toBe(true);
    expect(canLunchAt(dataForDate(again, '2026-10-07'), 12)).toBe(false);
  });

  it('responsável fixa aparece no rodízio do mês e some quando sai da equipe', async () => {
    const { monthRotation } = await import('../src/domain');
    const d = seed();
    const task = d.tasks.find((t) => t.assignment.mode === 'rotation' && t.assignment.period === 'week')!;
    task.holdersByPeriod = [{ id: 'fx', asbId: ID.ana, from: '2026-10-01', to: '2026-10-31' }];
    const r = monthRotation(d, task, 2026, 10, '2026-10-07')!;
    expect(r.weeks.every((w) => w.titularId === ID.ana)).toBe(true);
    d.absences.push(absence({ asbId: ID.ana, from: '2026-10-13', to: '2026-10-14' }));
    expect(describeTaskHolder(d, d.tasks.find((t) => t.name.startsWith('Conferência de prótese (11h'))!, '2026-10-01', '2026-10-31')).not.toContain('Ana');
    const conf = d.tasks.find((t) => t.name.startsWith('Conferência de prótese (11h'))!;
    conf.holdersByPeriod = [{ id: 'fx2', asbId: ID.ana, from: '2026-10-01', to: '2026-10-31' }];
    expect(describeTaskHolder(d, conf, '2026-10-01', '2026-10-31')).toContain('Ana (o mês inteiro; ausente 13/10 a 14/10)');
    d.asbs.find((a) => a.id === ID.ana)!.active = false;
    expect(describeTaskHolder(d, conf, '2026-10-01', '2026-10-31')).toBe('quem estiver na Sala 1 com Dra. Priscila (11h–15h)');
  });

  it('endereço do projeto ganha https:// e perde a barra final', async () => {
    const { normalizeUrl } = await import('../src/store/sync');
    expect(normalizeUrl(' abc.supabase.co/ ')).toBe('https://abc.supabase.co');
    expect(normalizeUrl('http://localhost:4190/')).toBe('http://localhost:4190');
  });
});

describe('sincronização: conflito entre aparelhos', () => {
  function cloud() {
    const rows = new Map<string, { data: unknown; updated_at: string }>();
    let tick = 0;
    const fetchFn = async (url: string, init?: RequestInit) => {
      const name = url.split('/rpc/')[1];
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const code = String(body.p_codigo);
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
      if (name === 'escala_get') { const r = rows.get(code); return json(r ? [r] : []); }
      if (name === 'escala_version') return json(rows.get(code)?.updated_at ?? null);
      if (name === 'escala_put') {
        const cur = rows.get(code);
        const expected = body.p_expected as string | null;
        if (cur && expected && cur.updated_at !== expected) return json({ message: 'conflito: a nuvem tem uma versao mais nova' }, 400);
        tick++;
        const at = `2026-10-07T10:00:${String(tick).padStart(2, '0')}Z`;
        rows.set(code, { data: body.p_data, updated_at: at });
        return json(at);
      }
      return json({ message: 'no' }, 404);
    };
    return { rows, fetchFn };
  }
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() } as unknown as Storage; };

  it('aparelho parado com mudança pendente não apaga o trabalho do outro: vira conflito e a pessoa decide', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const c = cloud();
    const cfg = { url: 'https://x.supabase.co', key: 'k', code: 'ceo-conf-lito-0001' };
    const statusA: SyncStatus[] = [];
    const lsA = mem(); const localA = new MemoryAdapter(); localA.raw = JSON.stringify(seed());
    const a = new SyncedAdapter(localA, new SupabaseRemote(cfg, c.fetchFn), lsA, (s) => statusA.push(s), () => true);
    await a.load();
    await vi.advanceTimersByTimeAsync(50);
    const lsB = mem(); const localB = new MemoryAdapter();
    const b = new SyncedAdapter(localB, new SupabaseRemote(cfg, c.fetchFn), lsB, () => undefined, () => true);
    await b.load();
    // B trabalha e envia
    const fromB = seed(); fromB.rules = ['DE B'];
    await b.save(fromB);
    await vi.advanceTimersByTimeAsync(2000);
    expect((c.rows.get(cfg.code)!.data as AppData).rules).toEqual(['DE B']);
    // A (que não viu a versão de B) muda e tenta enviar
    const fromA = seed(); fromA.rules = ['DE A'];
    await a.save(fromA);
    await vi.advanceTimersByTimeAsync(2000);
    expect((c.rows.get(cfg.code)!.data as AppData).rules).toEqual(['DE B']); // nada sobrescrito
    expect(statusA.at(-1)?.state).toBe('conflict');
    // A decide usar a da nuvem: fica com DE B e a versão de A vira cópia
    let got: AppData | null = null;
    await a.resolveConflict('cloud', (d) => { got = d; });
    expect(got!.rules).toEqual(['DE B']);
    expect(Object.keys(localA.copies)).toHaveLength(1);
    expect(statusA.at(-1)?.state).toBe('ok');
    // e depois consegue gravar normalmente
    const next = seed(); next.rules = ['DE A DEPOIS'];
    await a.save(next);
    await vi.advanceTimersByTimeAsync(2000);
    expect((c.rows.get(cfg.code)!.data as AppData).rules).toEqual(['DE A DEPOIS']);
    vi.useRealTimers();
  });

  it('"manter a deste aparelho" grava por cima e guarda a da nuvem como cópia', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const c = cloud();
    const cfg = { url: 'https://x.supabase.co', key: 'k', code: 'ceo-conf-lito-0002' };
    const lsA = mem(); const localA = new MemoryAdapter(); localA.raw = JSON.stringify(seed());
    const statusA: SyncStatus[] = [];
    const a = new SyncedAdapter(localA, new SupabaseRemote(cfg, c.fetchFn), lsA, (s) => statusA.push(s), () => true);
    await a.load();
    await vi.advanceTimersByTimeAsync(50);
    const other = seed(); other.rules = ['OUTRO'];
    c.rows.set(cfg.code, { data: other, updated_at: '2026-10-07T11:00:00Z' }); // alguém gravou por fora
    const mine = seed(); mine.rules = ['MINHA'];
    await a.save(mine);
    await vi.advanceTimersByTimeAsync(2000);
    expect(statusA.at(-1)?.state).toBe('conflict');
    await a.resolveConflict('mine', () => undefined);
    expect((c.rows.get(cfg.code)!.data as AppData).rules).toEqual(['MINHA']);
    expect(Object.values(localA.copies).some((raw) => (JSON.parse(raw) as AppData).rules[0] === 'OUTRO')).toBe(true);
    vi.useRealTimers();
  });
});
