import { describe, expect, it } from 'vitest';
import {
  addDays, formatDate, formatMonth, mod, mondayOf, monthsSince, weekdayOf, weeksOfMonth, weeksSince,
} from '../src/domain';
import { formatBlock, formatHour, formatRange, groupHours } from '../src/domain';

describe('datas', () => {
  it('calcula dia da semana sem fuso', () => {
    expect(weekdayOf('2026-09-07')).toBe(1); // segunda
    expect(weekdayOf('2026-09-13')).toBe(0); // domingo
    expect(weekdayOf('2026-09-24')).toBe(4); // quinta
  });

  it('acha a segunda-feira da semana', () => {
    expect(mondayOf('2026-09-07')).toBe('2026-09-07');
    expect(mondayOf('2026-09-11')).toBe('2026-09-07');
    expect(mondayOf('2026-09-13')).toBe('2026-09-07'); // domingo fecha a semana
    expect(mondayOf('2026-09-14')).toBe('2026-09-14');
  });

  it('conta semanas e meses desde a data de início', () => {
    expect(weeksSince('2026-09-07', '2026-09-07')).toBe(0);
    expect(weeksSince('2026-09-07', '2026-09-13')).toBe(0);
    expect(weeksSince('2026-09-07', '2026-09-14')).toBe(1);
    expect(weeksSince('2026-09-09', '2026-09-14')).toBe(1); // início no meio da semana
    expect(weeksSince('2026-09-07', '2026-08-31')).toBe(-1);
    expect(monthsSince('2026-09-01', '2026-09-30')).toBe(0);
    expect(monthsSince('2026-09-01', '2026-10-01')).toBe(1);
    expect(monthsSince('2026-09-15', '2027-01-02')).toBe(4);
    expect(monthsSince('2026-09-01', '2026-07-10')).toBe(-2);
  });

  it('módulo nunca negativo', () => {
    expect(mod(-1, 4)).toBe(3);
    expect(mod(5, 4)).toBe(1);
  });

  it('semanas de segunda a sexta que tocam o mês', () => {
    const weeks = weeksOfMonth(2026, 9); // setembro de 2026 começa numa terça
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toMatchObject({ index: 1, monday: '2026-08-31', friday: '2026-09-04' });
    expect(weeks[0].days).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
    expect(weeks[4]).toMatchObject({ index: 5, monday: '2026-09-28', friday: '2026-10-02' });
    expect(weeks[4].days).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);

    const nov = weeksOfMonth(2026, 11); // 1º de novembro é domingo, semana só entra no dia 2
    expect(nov[0].monday).toBe('2026-11-02');
    expect(nov).toHaveLength(5);

    const aug = weeksOfMonth(2026, 8); // 1º de agosto é sábado: essa semana não toca dias úteis
    expect(aug[0].monday).toBe('2026-08-03');
  });

  it('soma dias e formata', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(formatDate('2026-09-07')).toBe('07/09/2026');
    expect(formatMonth(2026, 9)).toBe('setembro de 2026');
  });
});

describe('horas', () => {
  it('formata no padrão da interface', () => {
    expect(formatHour(7)).toBe('07h');
    expect(formatRange(11, 15)).toBe('11h–15h');
    expect(formatBlock(18)).toBe('18h–19h');
  });

  it('agrupa horas consecutivas', () => {
    expect(groupHours([7, 8, 9, 12, 13, 15])).toEqual([[7, 10], [12, 14], [15, 16]]);
    expect(groupHours([])).toEqual([]);
  });
});
