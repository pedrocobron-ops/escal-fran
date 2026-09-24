import type { Absence, AppData, Id, IsoDate } from './types';
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
