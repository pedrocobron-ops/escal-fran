import { describe, expect, it } from 'vitest';
import { analyze, coverageSuggestions, effectiveDay, extraNeededToCover, allowedHours, resolveTask } from '../src/domain';
import { setDaySlots, setSlots, clearDayOverrides, removeSlotAt } from '../src/store/useStore';
import { parseBackup, exportBackup, seedData } from '../src/store/storage';
import { ID, absence, seed } from './helpers';

const MON = '2026-09-14';
const codes = (d: ReturnType<typeof seed>, date: string) => analyze(d, effectiveDay(d, date)).map((a) => a.code);

describe('folga de dentista', () => {
  it('a ASB dele fica livre e é remanejada para uma sala descoberta', () => {
    const d = seed();
    // Dra. Victoria (Sala 3, 07h–11h) de folga; Laura ausente sem substituta deixa a Sala 1 08h–11h descoberta.
    d.dentistAbsences = [{ id: 'df1', dentistId: 'id002', from: MON, to: MON, reason: 'Folga' }];
    d.absences.push(absence({ asbId: ID.laura, from: MON, to: MON }));
    const day = effectiveDay(d, MON);
    expect(day.dentistsOff.map((x) => x.id)).toEqual(['id002']);
    expect(day.dentists.some((x) => x.id === 'id002')).toBe(false);
    const andrea = (h: number) => day.slots.find((s) => s.who.type === 'asb' && s.who.asbId === ID.andrea && s.hour === h);
    // 07h: a Sala 1 não tem dentista, mas o CME da Laura precisa de alguém: Andrea vai para o CME
    expect(andrea(7)).toMatchObject({ kind: 'cme', origin: 'auto', movedFrom: 's3', coveringFor: ID.laura });
    // 08h–10h: remanejada para a Sala 1
    for (const h of [8, 9, 10]) expect(andrea(h)).toMatchObject({ kind: 'sala', roomId: 's1', origin: 'auto', movedFrom: 's3' });
    const alerts = analyze(d, day);
    expect(alerts.filter((a) => a.code === 'sala-sem-asb' && a.roomId === 's1').map((a) => a.hour)).toEqual([11, 13, 14]); // só o que Andrea não alcança
    expect(alerts.filter((a) => a.code === 'sala-sem-dentista')).toEqual([]);
    expect(alerts.find((a) => a.code === 'dentista-de-folga')?.message).toContain('Dra. Victoria');
    const rem = alerts.filter((a) => a.code === 'remanejada').map((a) => a.message);
    expect(rem).toEqual([
      'Andrea remanejada da Sala 3 para o CME / Arsenal (07h–08h), cobrindo Laura.',
      'Andrea remanejada da Sala 3 para a Sala 1 (08h–11h).',
    ]);
    expect(alerts.filter((a) => a.code === 'remanejada').every((a) => a.level === 'info')).toBe(true);
    // o aviso "ausente sem substituta" some onde a sala foi coberta
    expect(alerts.filter((a) => a.code === 'ausente-sem-substituta').map((a) => a.hour)).toEqual([11, 13, 14]);
  });

  it('sem sala descoberta, a ASB fica onde está e não há aviso', () => {
    const d = seed();
    d.dentistAbsences = [{ id: 'df1', dentistId: 'id002', from: MON, to: MON, reason: 'Folga' }];
    const c = codes(d, MON);
    expect(c.filter((x) => x === 'remanejada')).toEqual([]);
    expect(c.filter((x) => x === 'sala-sem-dentista')).toEqual([]);
    expect(c).toContain('dentista-de-folga');
  });

  it('tarefa que segue o dentista de folga diz isso', () => {
    const d = seed();
    d.dentistAbsences = [{ id: 'df1', dentistId: 'id001', from: MON, to: MON, reason: 'Folga' }];
    const r = resolveTask(d, d.tasks.find((t) => t.id === 'id018')!, MON);
    expect(r.holders).toEqual([]);
    expect(r.reason).toContain('de folga');
  });
});

describe('hora extra', () => {
  it('amplia as horas permitidas só naquela data', () => {
    const d = seed();
    d.extraShifts = [{ id: 'hx1', asbId: ID.nicelia, date: MON, start: 10, end: 13 }];
    const nic = d.asbs.find((a) => a.id === ID.nicelia)!;
    expect(allowedHours(nic, effectiveDay(d, MON).extraShifts)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(allowedHours(nic, effectiveDay(d, '2026-09-15').extraShifts)).toEqual([13, 14, 15, 16, 17, 18]);
  });

  it('ASB de hora extra sem atribuição cobre sala descoberta e ganha aviso onde sobra', () => {
    const d = seed();
    d.extraShifts = [{ id: 'hx1', asbId: ID.nicelia, date: MON, start: 8, end: 13 }];
    d.absences.push(absence({ asbId: ID.laura, from: MON, to: MON, reason: 'Folga' }));
    const day = effectiveDay(d, MON);
    const nic = (h: number) => day.slots.find((s) => s.who.type === 'asb' && s.who.asbId === ID.nicelia && s.hour === h);
    for (const h of [8, 9, 10, 11]) expect(nic(h)).toMatchObject({ kind: 'sala', roomId: 's1', origin: 'auto', extra: true });
    expect(nic(12)).toBeUndefined(); // Andrea já cobre a Sala 1 às 12h
    const alerts = analyze(d, day);
    expect(alerts.filter((a) => a.code === 'hora-extra-sem-atribuicao').map((a) => a.hour)).toEqual([12]);
    expect(alerts.find((a) => a.code === 'remanejada')?.message).toBe('Nicélia (hora extra) colocada na Sala 1 (08h–12h).');
    expect(alerts.filter((a) => a.code === 'sala-sem-asb' && a.roomId === 's1').map((a) => a.hour)).toEqual([13, 14]);
  });

  it('hora extra de quem está ausente não conta', () => {
    const d = seed();
    d.extraShifts = [{ id: 'hx1', asbId: ID.nicelia, date: MON, start: 8, end: 13 }];
    d.absences.push(absence({ asbId: ID.nicelia, from: MON, to: MON }));
    expect(effectiveDay(d, MON).extraShifts).toEqual([]);
  });
});

describe('ajustes do dia', () => {
  it('substituem a base só naquela data e "livre" tira a atribuição', () => {
    const d = seed();
    setDaySlots(d, MON, ID.laura, [8, 9], [{ kind: 'sala', roomId: 's2' }]);
    setDaySlots(d, MON, ID.laura, [10], []);
    const day = effectiveDay(d, MON);
    const laura = (h: number) => day.slots.filter((s) => s.who.type === 'asb' && s.who.asbId === ID.laura && s.hour === h);
    expect(laura(8)).toEqual([expect.objectContaining({ kind: 'sala', roomId: 's2', origin: 'override' })]);
    expect(laura(10)).toEqual([]);
    expect(laura(11)).toEqual([expect.objectContaining({ kind: 'sala', roomId: 's1', origin: 'base' })]);
    // outro dia continua igual à base
    const other = effectiveDay(d, '2026-09-15');
    expect(other.slots.find((s) => s.who.type === 'asb' && s.who.asbId === ID.laura && s.hour === 8)).toMatchObject({ roomId: 's1', origin: 'base' });
    clearDayOverrides(d, MON);
    expect(effectiveDay(d, MON).overrides).toEqual([]);
  });

  it('ajuste pode colocar a ASB em duas salas ao mesmo tempo, com aviso', () => {
    const d = seed();
    setDaySlots(d, MON, ID.laura, [9], [{ kind: 'sala', roomId: 's1' }, { kind: 'sala', roomId: 's2' }]);
    const alerts = analyze(d, effectiveDay(d, MON));
    expect(alerts.find((a) => a.code === 'asb-duas-salas')?.message).toBe('Laura cobre Sala 1 e Sala 2 ao mesmo tempo às 09h.');
    expect(alerts.filter((a) => a.code === 'sala-sem-asb' && a.hour === 9)).toEqual([]);
  });

  it('ajuste fora do contrato e sem hora extra é ignorado', () => {
    const d = seed();
    setDaySlots(d, MON, ID.nicelia, [8], [{ kind: 'sala', roomId: 's1' }]);
    expect(effectiveDay(d, MON).slots.some((s) => s.who.type === 'asb' && s.who.asbId === ID.nicelia && s.hour === 8)).toBe(false);
  });
});

describe('escala base com uma ASB em duas salas', () => {
  it('setSlots aditivo mantém a outra sala e gera aviso, não crítico', () => {
    const d = seed();
    setSlots(d, ID.laura, [9], { kind: 'sala', roomId: 's2' }, { additive: true });
    const mine = d.base.slots.filter((s) => s.asbId === ID.laura && s.hour === 9).map((s) => s.roomId).sort();
    expect(mine).toEqual(['s1', 's2']);
    const alerts = analyze(d, effectiveDay(d, MON));
    expect(alerts.some((a) => a.code === 'asb-duas-salas')).toBe(true);
    expect(alerts.filter((a) => a.code === 'sala-sem-asb' && a.hour === 9)).toEqual([]);
    // sem aditivo, substitui
    setSlots(d, ID.laura, [9], { kind: 'almoco' });
    expect(d.base.slots.filter((s) => s.asbId === ID.laura && s.hour === 9)).toHaveLength(1);
  });
});

describe('backup com os campos novos', () => {
  it('exporta e importa horas extras, folgas e ajustes', () => {
    const d = seedData();
    d.extraShifts = [{ id: 'hx1', asbId: ID.nicelia, date: MON, start: 8, end: 13 }];
    d.dentistAbsences = [{ id: 'df1', dentistId: 'id002', from: MON, to: MON, reason: 'Folga' }];
    d.dayOverrides = [{ id: 'o1', date: MON, asbId: ID.laura, hour: 8, kind: 'livre' }];
    const back = parseBackup(exportBackup(d));
    expect(back.extraShifts).toHaveLength(1);
    expect(back.dentistAbsences).toHaveLength(1);
    expect(back.dayOverrides).toHaveLength(1);
    const old = seedData() as Partial<ReturnType<typeof seedData>>;
    delete old.extraShifts;
    expect(parseBackup(JSON.stringify(old)).extraShifts).toEqual([]);
  });
});

describe('sugestão de cobertura', () => {
  it('ordena quem consegue cobrir mais blocos da ausente', () => {
    const d = seed();
    const s = coverageSuggestions(d, ID.laura, '2026-09-14', '2026-09-15');
    // Laura: 7 blocos com cobertura por dia (cme 07h, S1 08h–11h, S1 13h–14h) x 2 dias = 14
    expect(s[0].total).toBe(14);
    const byName = Object.fromEntries(s.map((x) => [x.name, x]));
    // Amanda está de apoio às 11h, 13h e 14h: cobre 3 por dia
    expect(byName['Amanda'].covered).toBe(6);
    // Nicélia entra às 13h: cobre 13h e 14h (apoio) = 2 por dia; 07h–11h só com hora extra
    expect(byName['Nicélia'].covered).toBe(4);
    expect(byName['Nicélia'].needsExtra).toBe(10);
    // Pâmela está em sala de manhã e apoio às 15h: cobre nada da Laura
    expect(byName['Pâmela'].covered).toBe(0);
    expect(s[0].name).toBe('Amanda');
  });

  it('considera hora extra da candidata e dias fechados', () => {
    const d = seed();
    d.extraShifts = [{ id: 'hx', asbId: ID.nicelia, date: '2026-09-14', start: 7, end: 13 }];
    const s = coverageSuggestions(d, ID.laura, '2026-09-12', '2026-09-14'); // sábado, domingo e segunda
    const nic = s.find((x) => x.name === 'Nicélia')!;
    expect(nic.total).toBe(7);
    expect(nic.covered).toBe(7);
  });
});

describe('horas extras para cobrir uma ausência', () => {
  it('Nicélia cobrindo a Laura precisa de 07h–12h de hora extra por dia útil', () => {
    const d = seed();
    const need = extraNeededToCover(d, ID.laura, ID.nicelia, '2026-09-12', '2026-09-15');
    // sábado e domingo fora; 07h (CME) e 08h–12h (Sala 1) contíguos; às 12h a Laura almoça
    expect(need).toEqual([
      { date: '2026-09-14', start: 7, end: 12 },
      { date: '2026-09-15', start: 7, end: 12 },
    ]);
  });

  it('com as horas extras criadas, a substituta cobre tudo e o dia fica sem alerta da Laura', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: MON, to: MON, reason: 'Folga', substitute: { asbId: ID.nicelia } }));
    const need = extraNeededToCover(d, ID.laura, ID.nicelia, MON, MON);
    d.extraShifts = need.map((n, i) => ({ id: `hx${i}`, asbId: ID.nicelia, ...n }));
    const day = effectiveDay(d, MON);
    expect(day.uncovered).toEqual([]);
    const nic = (h: number) => day.slots.find((s) => s.who.type === 'asb' && s.who.asbId === ID.nicelia && s.hour === h);
    expect(nic(7)).toMatchObject({ kind: 'cme', origin: 'substitute', extra: true });
    expect(nic(8)).toMatchObject({ kind: 'sala', roomId: 's1', origin: 'substitute', extra: true });
    expect(nic(13)).toMatchObject({ kind: 'sala', roomId: 's1', origin: 'substitute' });
    const alerts = analyze(d, day).map((a) => a.code);
    expect(alerts.filter((c) => c === 'sala-sem-asb')).toHaveLength(1); // só Sala 2 às 18h
    expect(alerts).not.toContain('substituta-choque');
  });
});

describe('apoio de uma sala específica', () => {
  it('não conta como ASB da sala, não gera "duas na mesma sala" e aparece no PDF', async () => {
    const { dayPdfModel } = await import('../src/pdf/model');
    const d = seed();
    // Ana (apoio geral às 10h) vira apoio da Sala 4 às 10h, onde a Pâmela é a ASB
    setSlots(d, ID.ana, [10], { kind: 'apoio', roomId: 's4' });
    const day = effectiveDay(d, MON);
    expect(day.slots.find((s) => s.who.type === 'asb' && s.who.asbId === ID.ana && s.hour === 10)).toMatchObject({ kind: 'apoio', roomId: 's4' });
    const codes = analyze(d, day).map((a) => a.code);
    expect(codes).not.toContain('duas-asbs-mesma-sala');
    expect(codes).not.toContain('bloco-sem-atribuicao');
    const pdf = dayPdfModel(d, MON);
    expect(pdf.rows[3].cells[3].asb).toBe('ASB: Pâmela (apoio: Ana)');
    expect(pdf.rows[3].cells[4].asb).toBe('Priscila'); // coluna Apoio / Recepção sem a Ana
    expect(pdf.asbRows.find((r) => r.name === 'Ana')!.morning).toContain('Apoio da Sala 4 (10h–11h)');
  });

  it('apoio de sala sozinho não cobre a sala: continua alerta de sala sem ASB', () => {
    const d = seed();
    d.base.slots = d.base.slots.filter((s) => !(s.asbId === ID.pamela && s.hour === 9));
    setSlots(d, ID.ana, [9], { kind: 'apoio', roomId: 's4' }); // Ana não está no contrato às 09h: ignorado
    setSlots(d, ID.laura, [9], { kind: 'apoio', roomId: 's4' });
    const codes = analyze(d, effectiveDay(d, MON)).filter((a) => a.hour === 9).map((a) => a.code);
    expect(codes).toContain('sala-sem-asb');
  });

  it('continuar na sala e ser apoio de outra ao mesmo tempo gera aviso de sala dividida', () => {
    const d = seed();
    setSlots(d, ID.laura, [9], { kind: 'apoio', roomId: 's4' }, { additive: true });
    expect(d.base.slots.filter((s) => s.asbId === ID.laura && s.hour === 9).map((s) => `${s.kind}:${s.roomId}`).sort()).toEqual(['apoio:s4', 'sala:s1']);
    const alerts = analyze(d, effectiveDay(d, MON));
    expect(alerts.find((a) => a.code === 'asb-duas-salas')?.message).toBe('Laura cobre Sala 1 e Sala 4 ao mesmo tempo às 09h.');
  });

  it('removeSlotAt tira só o apoio da sala', () => {
    const d = seed();
    setSlots(d, ID.laura, [9], { kind: 'apoio', roomId: 's4' }, { additive: true });
    removeSlotAt(d, ID.laura, 9, 'apoio', 's4');
    expect(d.base.slots.filter((s) => s.asbId === ID.laura && s.hour === 9).map((s) => s.kind)).toEqual(['sala']);
  });
});
