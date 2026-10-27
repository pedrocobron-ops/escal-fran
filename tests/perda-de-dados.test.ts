// 27/10/2026: o Francisco perdeu dias de trabalho. A nuvem foi sobrescrita por um
// navegador com a escala inicial. Estes testes garantem que isso não se repete.
import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/store/storage';
import { SupabaseRemote, SyncedAdapter, type SyncStatus } from '../src/store/sync';
import { AuthError } from '../src/store/auth';
import { ID, absence, seed } from './helpers';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() } as unknown as Storage; };

function cloud(opts: { failGets?: number } = {}) {
  let row: { data: unknown; updated_at: string } | null = null;
  let tick = 0;
  let failGets = opts.failGets ?? 0;
  const puts: unknown[] = [];
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchFn = async (url: string, init?: RequestInit) => {
    const name = url.split('/rpc/')[1];
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (name === 'minha_escala_get') {
      if (failGets > 0) { failGets--; throw new TypeError('rede'); }
      return json(row ? [row] : []);
    }
    if (name === 'minha_escala_version') return json(row?.updated_at ?? null);
    if (name === 'minha_escala_put') {
      // mesma regra do banco: com escala na conta, precisa dizer qual versão substitui
      if (row && (body.p_expected === null || body.p_expected !== row.updated_at)) return json({ message: 'conflito: a nuvem tem uma versao mais nova' }, 400);
      tick++;
      row = { data: body.p_data, updated_at: `2026-10-27T10:00:${String(tick).padStart(2, '0')}Z` };
      puts.push(body.p_data);
      return json(row.updated_at);
    }
    return json({ message: 'no' }, 404);
  };
  return { fetchFn, puts, get row() { return row; }, set row(r) { row = r; } };
}

describe('perda de dados de 27/10', () => {
  it('a escala da nuvem que substitui a deste aparelho deixa a deste aparelho guardada como cópia', async () => {
    const c = cloud();
    const trabalho = seed();
    trabalho.absences.push(absence({ asbId: ID.laura, from: '2026-10-20', to: '2026-10-24', reason: 'Férias' }));
    c.row = { data: seed(), updated_at: '2026-10-27T09:00:00Z' }; // nuvem com outra versão
    const ls = mem();
    const local = new MemoryAdapter();
    local.raw = JSON.stringify(trabalho);
    let kept = 0;
    const a = new SyncedAdapter(local, new SupabaseRemote({ url: 'https://x.supabase.co', key: 'k' }, async () => 't', c.fetchFn), ls, () => undefined, () => true);
    a.onCopyKept = () => kept++;
    const r = await a.load();
    expect(r.status).toBe('ok');
    expect(kept).toBe(1);
    const copies = Object.values(local.copies);
    expect(copies.some((raw) => raw.includes('Férias') && raw.includes('2026-10-20'))).toBe(true);
  });

  it('nuvem fora do ar na abertura: a primeira mudança não grava por cima da escala da conta; vira pergunta', async () => {
    const c = cloud({ failGets: 1 });
    const daConta = seed();
    daConta.absences.push(absence({ asbId: ID.laura, from: '2026-10-20', to: '2026-10-24', reason: 'Férias' }));
    c.row = { data: daConta, updated_at: '2026-10-24T09:00:00Z' };
    const statuses: SyncStatus[] = [];
    const local = new MemoryAdapter(); // navegador sem nada (escala inicial)
    const a = new SyncedAdapter(local, new SupabaseRemote({ url: 'https://x.supabase.co', key: 'k' }, async () => 't', c.fetchFn), mem(), (s) => statuses.push(s), () => true);
    await a.load();
    await a.save(seed());
    a.flush();
    await new Promise((r) => setTimeout(r, 30));
    expect(c.puts).toEqual([]);
    expect(JSON.stringify(c.row?.data)).toContain('Férias');
    expect(statuses.some((s) => s.state === 'conflict')).toBe(true);
  });

  it('nuvem fora do ar não derruba o login (só sessão vencida pede para entrar de novo)', async () => {
    const statuses: SyncStatus[] = [];
    const remote = new SupabaseRemote({ url: 'https://x.supabase.co', key: 'k' }, async () => { throw new AuthError('A nuvem não renovou a sessão (521).', 'servidor'); }, async () => new Response('{}'));
    const a = new SyncedAdapter(new MemoryAdapter(), remote, mem(), (s) => statuses.push(s), () => true);
    await a.load();
    expect(statuses.some((s) => s.state === 'sem-login')).toBe(false);
    expect(statuses.some((s) => s.state === 'offline')).toBe(true);
    const r2 = new SupabaseRemote({ url: 'https://x.supabase.co', key: 'k' }, async () => { throw new AuthError('Sua sessão venceu.', 'sem-sessao'); }, async () => new Response('{}'));
    const st2: SyncStatus[] = [];
    await new SyncedAdapter(new MemoryAdapter(), r2, mem(), (s) => st2.push(s), () => true).load();
    expect(st2.some((s) => s.state === 'sem-login')).toBe(true);
  });
});
