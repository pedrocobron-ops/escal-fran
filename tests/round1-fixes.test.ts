import { describe, expect, it } from 'vitest';
import {
  analyze, coverageSuggestions, effectiveDay, extraNeededToCover, isReasonablePeriod, stillUncovered,
} from '../src/domain';
import { setDaySlots } from '../src/store/useStore';
import { ID, absence, seed } from './helpers';

const DAY = '2026-10-15'; // quinta
const who = (d: ReturnType<typeof seed>, asbId: string, h: number) =>
  effectiveDay(d, DAY).slots.filter((s) => s.who.type === 'asb' && s.who.asbId === asbId && s.hour === h);

describe('sala sem dentista atendendo não precisa de cobertura', () => {
  it('Laura ausente com Dr. Francisco de folga: só CME e Prótese contam, sem alerta falso', () => {
    const d = seed();
    d.dentistAbsences = [{ id: 'df', dentistId: 'id001', from: DAY, to: DAY, reason: 'Folga' }];
    d.absences.push(absence({ asbId: ID.laura, from: DAY, to: DAY }));
    const alerts = analyze(d, effectiveDay(d, DAY));
    const aus = alerts.filter((a) => a.code === 'ausente-sem-substituta').map((a) => a.hour);
    expect(aus).toEqual([7]); // 08h–10h (Sala 1 de folga) não contam; 11h, 13h e 14h o apoio cobre
    const s = coverageSuggestions(d, ID.laura, DAY, DAY);
    expect(s[0].total).toBe(4);
    expect(extraNeededToCover(d, ID.laura, ID.nicelia, DAY, DAY)).toEqual([
      { date: DAY, start: 7, end: 8 },
      { date: DAY, start: 11, end: 12 },
    ]);
  });
});

describe('ASB livre por folga do dentista é boa substituta', () => {
  it('Pâmela (Dra. Juliana de folga) cobre CME e Sala 1 da Laura de manhã', () => {
    const d = seed();
    d.dentistAbsences = [{ id: 'df', dentistId: 'id003', from: DAY, to: DAY, reason: 'Folga' }];
    d.absences.push(absence({ asbId: ID.laura, from: DAY, to: DAY, substitute: { asbId: ID.pamela } }));
    const pam = coverageSuggestions(d, ID.laura, DAY, DAY, `abs-${ID.laura}-${DAY}`).find((x) => x.name === 'Pâmela')!;
    expect(pam.covered).toBe(5); // 07h CME, 08h–11h Sala 1 (às 11h ela está de apoio)
    expect(who(d, ID.pamela, 7)).toEqual([expect.objectContaining({ kind: 'cme', origin: 'substitute', coveringFor: ID.laura, movedFrom: 's4' })]);
    expect(who(d, ID.pamela, 9)).toEqual([expect.objectContaining({ kind: 'sala', roomId: 's1', origin: 'substitute' })]);
    // Onde ela está ocupada (Sala 4 com Dr. Marco às 13h e 14h), o apoio cobre: sem choque pendente
    const alerts = analyze(d, effectiveDay(d, DAY));
    expect(alerts.filter((a) => a.code === 'substituta-choque')).toEqual([]);
    expect(alerts.filter((a) => a.code === 'sala-sem-asb' && a.roomId === 's1')).toEqual([]);
  });
});

describe('ajuste manual vence o remanejamento automático', () => {
  it('tirar a ASB colocada pela hora extra deixa a sala sem ASB (alerta volta)', () => {
    const d = seed();
    d.extraShifts = [{ id: 'hx', asbId: ID.amanda, date: DAY, start: 18, end: 19 }];
    expect(who(d, ID.amanda, 18)).toEqual([expect.objectContaining({ roomId: 's2', origin: 'auto' })]);
    setDaySlots(d, DAY, ID.amanda, [18], [], { hold: true }); // tirada à mão de uma cobertura automática
    expect(who(d, ID.amanda, 18)).toEqual([]);
    const alerts = analyze(d, effectiveDay(d, DAY));
    expect(alerts.some((a) => a.code === 'sala-sem-asb' && a.roomId === 's2' && a.hour === 18)).toBe(true);
  });
});

describe('hora extra também cobre CME e almoxarifado de quem faltou', () => {
  it('Amanda com extra 07h–09h cobre o CME da Laura às 07h e a Sala 1 às 08h', () => {
    const d = seed();
    d.extraShifts = [{ id: 'hx', asbId: ID.amanda, date: DAY, start: 7, end: 9 }];
    d.absences.push(absence({ asbId: ID.laura, from: DAY, to: DAY }));
    expect(who(d, ID.amanda, 7)).toEqual([expect.objectContaining({ kind: 'cme', origin: 'auto', coveringFor: ID.laura })]);
    expect(who(d, ID.amanda, 8)).toEqual([expect.objectContaining({ kind: 'sala', roomId: 's1', origin: 'auto' })]);
    const alerts = analyze(d, effectiveDay(d, DAY));
    // 10h, 11h, 13h e 14h: quem está no apoio cobre; às 09h ninguém está livre
    expect(alerts.filter((a) => a.code === 'ausente-sem-substituta').map((a) => a.hour)).toEqual([9]);
    expect(alerts.filter((a) => a.code === 'hora-extra-sem-atribuicao')).toEqual([]);
    expect(alerts.find((a) => a.code === 'remanejada' && a.hour === 7)?.message).toBe('Amanda (hora extra) colocada no CME / Arsenal (07h–08h), cobrindo Laura.');
    expect(stillUncovered(d, ID.laura, DAY, DAY)).toEqual([{ date: DAY, hours: [9] }]);
  });
});

describe('datas digitadas pela metade não travam', () => {
  it('períodos absurdos são recusados sem calcular', () => {
    expect(isReasonablePeriod('0002-05-01', '2026-10-15')).toBe(false);
    expect(isReasonablePeriod('0202-05-01', '2026-10-15')).toBe(false);
    expect(isReasonablePeriod('2026-01-01', '2027-12-31')).toBe(false);
    expect(isReasonablePeriod('2026-10-15', '2026-10-01')).toBe(false);
    expect(isReasonablePeriod('2026-10-01', '2026-10-30')).toBe(true);
    const t = performance.now();
    expect(coverageSuggestions(seed(), ID.laura, '0002-05-01', '2026-10-15')).toEqual([]);
    expect(performance.now() - t).toBeLessThan(50);
  });
});
