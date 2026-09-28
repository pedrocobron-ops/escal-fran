import type { Absence, AppData, DentistAbsence, ExtraShift, Id, IsoDate } from './types';
import { isBetween } from './dates';

/** Ausências que valem numa data. */
export function absencesOn(data: Pick<AppData, 'absences'>, date: IsoDate): Absence[] {
  return data.absences.filter((a) => isBetween(date, a.from, a.to));
}

/** Primeira ausência de uma ASB numa data, se houver. */
export function absenceFor(data: Pick<AppData, 'absences'>, asbId: Id, date: IsoDate): Absence | undefined {
  return absencesOn(data, date).find((a) => a.asbId === asbId);
}

export function isAbsent(data: Pick<AppData, 'absences'>, asbId: Id, date: IsoDate): boolean {
  return absenceFor(data, asbId, date) !== undefined;
}

/** Ausências que tocam o intervalo [from, to]. */
export function absencesBetween(data: Pick<AppData, 'absences'>, from: IsoDate, to: IsoDate): Absence[] {
  return data.absences.filter((a) => a.from <= to && a.to >= from);
}

export function isExternalSubstitute(a: Absence): a is Absence & { substitute: { externalName: string } } {
  return a.substitute !== undefined && 'externalName' in a.substitute;
}

export function isTeamSubstitute(a: Absence): a is Absence & { substitute: { asbId: Id } } {
  return a.substitute !== undefined && 'asbId' in a.substitute;
}

/** Ausências da mesma ASB que se sobrepõem ao período, ignorando a própria (ao editar). */
export function overlappingAbsences(data: Pick<AppData, 'absences'>, asbId: Id, from: IsoDate, to: IsoDate, exceptId?: Id): Absence[] {
  return data.absences.filter((a) => a.id !== exceptId && a.asbId === asbId && a.from <= to && a.to >= from);
}

/** Folgas de dentistas que valem numa data. */
export function dentistAbsencesOn(data: Pick<AppData, 'dentistAbsences'>, date: IsoDate): DentistAbsence[] {
  return (data.dentistAbsences ?? []).filter((a) => isBetween(date, a.from, a.to));
}

export function dentistAbsenceFor(data: Pick<AppData, 'dentistAbsences'>, dentistId: Id, date: IsoDate): DentistAbsence | undefined {
  return dentistAbsencesOn(data, date).find((a) => a.dentistId === dentistId);
}

export function dentistAbsencesBetween(data: Pick<AppData, 'dentistAbsences'>, from: IsoDate, to: IsoDate): DentistAbsence[] {
  return (data.dentistAbsences ?? []).filter((a) => a.from <= to && a.to >= from);
}

export function overlappingDentistAbsences(data: Pick<AppData, 'dentistAbsences'>, dentistId: Id, from: IsoDate, to: IsoDate, exceptId?: Id): DentistAbsence[] {
  return (data.dentistAbsences ?? []).filter((a) => a.id !== exceptId && a.dentistId === dentistId && a.from <= to && a.to >= from);
}

/** Horas extras numa data. */
export function extraShiftsOn(data: Pick<AppData, 'extraShifts'>, date: IsoDate): ExtraShift[] {
  return (data.extraShifts ?? []).filter((e) => e.date === date);
}

export function extraShiftsBetween(data: Pick<AppData, 'extraShifts'>, from: IsoDate, to: IsoDate): ExtraShift[] {
  return (data.extraShifts ?? []).filter((e) => e.date >= from && e.date <= to);
}

/** Horas extras que valem: tira as de dias em que a própria ASB está ausente. */
export function validExtraShiftsBetween(data: Pick<AppData, 'extraShifts' | 'absences'>, from: IsoDate, to: IsoDate): ExtraShift[] {
  return extraShiftsBetween(data, from, to).filter((e) => !absenceFor(data, e.asbId, e.date));
}

/** Horas extras da mesma ASB que se sobrepõem a um horário numa data. */
export function overlappingExtras(data: Pick<AppData, 'extraShifts'>, asbId: Id, date: IsoDate, start: number, end: number, exceptId?: Id): ExtraShift[] {
  return (data.extraShifts ?? []).filter((e) => e.id !== exceptId && e.asbId === asbId && e.date === date && e.start < end && e.end > start);
}

/** Partes de um horário que ficam fora do contrato (o que vira hora extra de verdade). */
export function outsideContract(start: number, end: number, contract: { start: number; end: number }): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (start < contract.start) out.push([start, Math.min(end, contract.start)]);
  if (end > contract.end) out.push([Math.max(start, contract.end), end]);
  return out.filter(([a, b]) => b > a);
}

/** Horas de uma hora extra que ficam fora do contrato (as que contam para pagamento). */
export function paidExtraHours(e: ExtraShift, contract: { start: number; end: number } | undefined): number {
  let n = 0;
  for (let h = e.start; h < e.end; h++) {
    if (!contract || h < contract.start || h >= contract.end) n++;
  }
  return n;
}
