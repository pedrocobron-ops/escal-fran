import { describe, expect, it } from 'vitest';
import {
  analyze, analyzeBase, analyzeDate, canAssign, effectiveDay, nextProteseRecords, proteseAlerts, validHours,
  type Alert,
} from '../src/domain';
import { ID, absence, seed } from './helpers';

const byCode = (alerts: Alert[], code: Alert['code']) => alerts.filter((a) => a.code === code);

describe('escala base do seed', () => {
  it('tem exatamente um alerta: Sala 2 às 18h sem ASB (pergunta 1 do cliente)', () => {
    const alerts = analyzeBase(seed());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: 'critico', code: 'sala-sem-asb', hour: 18, roomId: 's2' });
    expect(alerts[0].message).toContain('Sala 2');
    expect(alerts[0].message).toContain('18h');
  });

  it('num dia útil comum dá o mesmo alerta', () => {
    const alerts = analyzeDate(seed(), '2026-09-14');
    expect(alerts.map((a) => a.code)).toEqual(['sala-sem-asb']);
  });

  it('num dia em que o CEO não abre não há alertas', () => {
    const day = effectiveDay(seed(), '2026-09-13');
    expect(day.open).toBe(false);
    expect(analyze(seed(), day)).toEqual([]);
  });
});

describe('validações críticas', () => {
  it('sala com dentista sem ASB gera alerta crítico', () => {
    const d = seed();
    // Tira a Pâmela da Sala 4 às 09h (Dra. Juliana atende 07h–11h).
    d.base.slots = d.base.slots.filter((s) => !(s.asbId === ID.pamela && s.hour === 9));
    const alerts = analyzeBase(d);
    const critical = byCode(alerts, 'sala-sem-asb');
    expect(critical).toHaveLength(2);
    expect(critical.find((a) => a.roomId === 's4' && a.hour === 9)).toMatchObject({ level: 'critico' });
    expect(critical.find((a) => a.roomId === 's4' && a.hour === 9)?.message).toContain('Dra. Juliana');
    // e o bloco da Pâmela fica sem atribuição
    expect(byCode(alerts, 'bloco-sem-atribuicao')).toEqual([expect.objectContaining({ asbId: ID.pamela, hour: 9 })]);
  });

  it('ASB com almoço obrigatório sem bloco de almoço gera alerta crítico', () => {
    const d = seed();
    d.base.slots = d.base.slots.map((s) =>
      s.asbId === ID.laura && s.kind === 'almoco' ? { ...s, kind: 'sala', roomId: 's1' } : s,
    );
    const alerts = analyzeBase(d);
    expect(byCode(alerts, 'sem-almoco')).toEqual([expect.objectContaining({ level: 'critico', asbId: ID.laura })]);
    expect(byCode(alerts, 'sem-almoco')[0].message).toContain('Laura');
    // Andrea e Nicélia não saem para almoço: sem alerta para elas
    expect(byCode(alerts, 'sem-almoco').some((a) => a.asbId === ID.andrea || a.asbId === ID.nicelia)).toBe(false);
    // e agora Laura e Andrea estão as duas na Sala 1 às 12h
    expect(byCode(alerts, 'duas-asbs-mesma-sala')).toEqual([expect.objectContaining({ roomId: 's1', hour: 12 })]);
  });

  it('ASB sem almoço no contrato não gera alerta', () => {
    const alerts = analyzeBase(seed());
    expect(byCode(alerts, 'sem-almoco')).toEqual([]);
  });
});

describe('avisos', () => {
  it('ASB em sala sem dentista', () => {
    const d = seed();
    // Laura no CME às 07h vira Sala 1 às 07h (Dr. Francisco só começa às 08h).
    d.base.slots = d.base.slots.map((s) => (s.asbId === ID.laura && s.hour === 7 ? { ...s, kind: 'sala', roomId: 's1' } : s));
    const alerts = analyzeBase(d);
    expect(byCode(alerts, 'sala-sem-dentista')).toEqual([expect.objectContaining({ level: 'aviso', asbId: ID.laura, roomId: 's1', hour: 7 })]);
  });

  it('bloco do contrato sem atribuição', () => {
    const d = seed();
    d.base.slots = d.base.slots.filter((s) => !(s.asbId === ID.nicelia && s.hour === 13));
    const alerts = analyzeBase(d);
    expect(byCode(alerts, 'bloco-sem-atribuicao')).toEqual([expect.objectContaining({ asbId: ID.nicelia, hour: 13 })]);
    expect(byCode(alerts, 'bloco-sem-atribuicao')[0].message).toContain('13h–19h');
  });

  it('ASB inativa some da escala e não gera avisos', () => {
    const d = seed();
    const nic = d.asbs.find((a) => a.id === ID.nicelia)!;
    nic.active = false;
    const alerts = analyzeBase(d);
    expect(byCode(alerts, 'bloco-sem-atribuicao')).toEqual([]);
    // Sala 1 à tarde fica sem ASB
    expect(byCode(alerts, 'sala-sem-asb').filter((a) => a.roomId === 's1').map((a) => a.hour)).toEqual([15, 16, 17, 18]);
  });
});

describe('bloqueio no drop', () => {
  it('só aceita blocos dentro do contrato', () => {
    const andrea = seed().asbs.find((a) => a.id === ID.andrea)!; // 07h–13h
    expect(canAssign(andrea, 7)).toBe(true);
    expect(canAssign(andrea, 12)).toBe(true);
    expect(canAssign(andrea, 13)).toBe(false);
    expect(canAssign(andrea, 6)).toBe(false);
    expect(validHours(andrea)).toEqual([7, 8, 9, 10, 11, 12]);
    const nic = seed().asbs.find((a) => a.id === ID.nicelia)!;
    expect(validHours(nic)).toEqual([13, 14, 15, 16, 17, 18]);
  });
});

describe('escala efetiva com ausências', () => {
  it('ausente sem substituta: slots somem e a sala fica descoberta', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-18', reason: 'Férias' }));
    const day = effectiveDay(d, '2026-09-15');
    expect(day.slots.some((s) => s.who.type === 'asb' && s.who.asbId === ID.laura)).toBe(false);
    expect(day.presentAsbIds).not.toContain(ID.laura);
    expect(day.absences).toHaveLength(1);
    const alerts = analyze(d, day);
    // Sala 1: Francisco 08h–11h e Priscila 11h–15h (Andrea cobre às 12h)
    expect(byCode(alerts, 'sala-sem-asb').filter((a) => a.roomId === 's1').map((a) => a.hour)).toEqual([8, 9, 10, 11, 13, 14]);
    expect(byCode(alerts, 'ausente-sem-substituta').map((a) => a.hour)).toEqual([7, 8, 9, 10, 11, 13, 14]);
    // Laura ausente não gera "sem almoço" nem "bloco sem atribuição"
    expect(byCode(alerts, 'sem-almoco')).toEqual([]);
    expect(byCode(alerts, 'bloco-sem-atribuicao')).toEqual([]);
  });

  it('substituta da equipe herda os slots quando está livre e gera aviso de choque quando não está', () => {
    const d = seed();
    // Amanda (09h–18h): almox 09h–10h, apoio 11h, almoço 12h, apoio 13h–14h, Sala 2 15h–17h.
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-14', substitute: { asbId: ID.amanda } }));
    const day = effectiveDay(d, '2026-09-14');
    const amanda = day.slots.filter((s) => s.who.type === 'asb' && s.who.asbId === ID.amanda);
    const at = (h: number) => amanda.find((s) => s.hour === h);
    // herda a Sala 1 nos blocos em que estava de apoio
    expect(at(11)).toMatchObject({ kind: 'sala', roomId: 's1', origin: 'substitute', coveringFor: ID.laura });
    expect(at(13)).toMatchObject({ kind: 'sala', roomId: 's1', origin: 'substitute' });
    expect(at(14)).toMatchObject({ kind: 'sala', roomId: 's1', origin: 'substitute' });
    // continua no almoxarifado e no almoço
    expect(at(9)).toMatchObject({ kind: 'almox', origin: 'base' });
    expect(at(12)).toMatchObject({ kind: 'almoco', origin: 'base' });
    // não ganha slot fora do contrato
    expect(at(7)).toBeUndefined();
    expect(at(8)).toBeUndefined();
    // nada duplicado
    expect(amanda.filter((s) => s.hour === 11)).toHaveLength(1);

    expect(day.uncovered.map((u) => [u.slot.hour, u.reason])).toEqual([
      [7, 'substituta-fora-do-contrato'],
      [8, 'substituta-fora-do-contrato'],
      [9, 'substituta-ocupada'],
      [10, 'substituta-ocupada'],
    ]);

    const alerts = analyze(d, day);
    const choque = byCode(alerts, 'substituta-choque');
    expect(choque.map((a) => a.hour)).toEqual([7, 8, 9, 10]);
    expect(choque.every((a) => a.level === 'aviso' && a.asbId === ID.amanda)).toBe(true);
    expect(choque[2].message).toContain('Amanda');
    expect(choque[2].message).toContain('Laura');
    // Sala 1 às 08h, 09h e 10h fica sem ASB (Francisco atende); 07h não tem dentista
    expect(byCode(alerts, 'sala-sem-asb').filter((a) => a.roomId === 's1').map((a) => a.hour)).toEqual([8, 9, 10]);
    // Amanda continua com almoço e sem buracos no contrato
    expect(byCode(alerts, 'sem-almoco')).toEqual([]);
    expect(byCode(alerts, 'bloco-sem-atribuicao')).toEqual([]);
  });

  it('substituta que já está em sala ou no almoço gera choque de sala', () => {
    const d = seed();
    // Pâmela cobre Laura: Pâmela está na Sala 4 de manhã e almoça às 11h.
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-14', substitute: { asbId: ID.pamela } }));
    const day = effectiveDay(d, '2026-09-14');
    const reasons = Object.fromEntries(day.uncovered.map((u) => [u.slot.hour, u.busyWith ?? u.reason]));
    expect(reasons).toEqual({ 7: 'sala', 8: 'sala', 9: 'sala', 10: 'sala', 11: 'almoco', 13: 'sala', 14: 'sala' });
    const alerts = analyze(d, day);
    expect(byCode(alerts, 'substituta-choque').find((a) => a.hour === 11)?.message).toContain('almoço');
    expect(byCode(alerts, 'substituta-choque').find((a) => a.hour === 8)?.message).toContain('outra sala');
    // Pâmela não perdeu nenhum slot dela
    expect(day.slots.filter((s) => s.who.type === 'asb' && s.who.asbId === ID.pamela)).toHaveLength(9);
  });

  it('substituta também ausente deixa tudo descoberto', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-14', substitute: { asbId: ID.amanda } }));
    d.absences.push(absence({ asbId: ID.amanda, from: '2026-09-14', to: '2026-09-14' }));
    const day = effectiveDay(d, '2026-09-14');
    const lauraUncovered = day.uncovered.filter((u) => u.slot.asbId === ID.laura);
    expect(lauraUncovered.map((u) => u.slot.hour)).toEqual([7, 8, 9, 10, 11, 13, 14]);
    expect(lauraUncovered.every((u) => u.reason === 'substituta-ausente')).toBe(true);
    // a Amanda, sem substituta, também fica descoberta
    expect(day.uncovered.filter((u) => u.slot.asbId === ID.amanda).every((u) => u.reason === 'sem-substituta')).toBe(true);
    expect(day.slots.some((s) => s.who.type === 'asb' && s.who.asbId === ID.amanda)).toBe(false);
  });

  it('substituta externa assume todos os slots com o nome dela', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-14', reason: 'Licença', substitute: { externalName: 'Carla' } }));
    const day = effectiveDay(d, '2026-09-14');
    const carla = day.slots.filter((s) => s.who.type === 'external' && s.who.name === 'Carla');
    expect(carla).toHaveLength(9);
    expect(carla.find((s) => s.hour === 8)).toMatchObject({ kind: 'sala', roomId: 's1', origin: 'external', coveringFor: ID.laura });
    expect(day.uncovered).toEqual([]);
    const alerts = analyze(d, day);
    expect(alerts.map((a) => a.code)).toEqual(['sala-sem-asb']); // só o da Sala 2 às 18h
  });

  it('ausência fora da data não muda nada', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-14' }));
    const day = effectiveDay(d, '2026-09-15');
    expect(day.absences).toEqual([]);
    expect(day.slots).toHaveLength(seed().base.slots.length);
  });
});

describe('regra da Prótese (1 mês fixa)', () => {
  it('registra a ASB atual e avisa quando muda antes de 1 mês', () => {
    const d = seed();
    d.protese = nextProteseRecords(d, '2026-09-01');
    expect(d.protese).toEqual([
      { dentistId: ID.drPriscila, asbId: ID.laura, since: '2026-09-01' },
      { dentistId: ID.isac, asbId: ID.nicelia, since: '2026-09-01' },
    ]);
    expect(proteseAlerts(d, '2026-09-15')).toEqual([]);

    // Troca Nicélia por Ana na Sala 1 à tarde.
    d.base.slots = d.base.slots.map((s) =>
      s.asbId === ID.nicelia && s.kind === 'sala' ? { ...s, asbId: ID.ana } : s,
    );
    const alerts = proteseAlerts(d, '2026-09-15');
    expect(alerts).toEqual([expect.objectContaining({ code: 'protese-trocou-antes-do-mes', level: 'aviso', roomId: 's1', asbId: ID.ana })]);
    expect(alerts[0].message).toContain('Nicélia');
    expect(alerts[0].message).toContain('Ana');

    // O registro antigo continua enquanto o mês não fecha...
    expect(nextProteseRecords(d, '2026-09-15')?.find((r) => r.dentistId === ID.isac)?.asbId).toBe(ID.nicelia);
    // ...e depois de 1 mês passa a valer a nova, sem aviso.
    expect(nextProteseRecords(d, '2026-10-01')?.find((r) => r.dentistId === ID.isac)).toEqual({ dentistId: ID.isac, asbId: ID.ana, since: '2026-10-01' });
    expect(proteseAlerts(d, '2026-10-01')).toEqual([]);
  });
});
