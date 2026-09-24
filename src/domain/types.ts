// Modelo de dados do sistema (seção 4 do SPEC). Tudo aqui é puro e serializável.

export type Id = string;

/** Data no formato ISO `YYYY-MM-DD`, sem fuso horário. */
export type IsoDate = string;

export interface Room {
  id: Id;
  name: string;
  color: string;
  order: number;
}

export interface Dentist {
  id: Id;
  name: string;
  specialty: string;
  roomId: Id;
  /** Hora inteira de início, ex.: 11. */
  start: number;
  /** Hora inteira de fim (exclusiva), ex.: 15. */
  end: number;
  /** 0=dom ... 6=sáb. Vazio ou ausente = segunda a sexta. */
  days?: number[];
}

export interface Asb {
  id: Id;
  name: string;
  /** Início do contrato, hora inteira. */
  start: number;
  /** Fim do contrato, hora inteira (exclusiva). */
  end: number;
  /** true = precisa de 1 hora de almoço. */
  lunch: boolean;
  active: boolean;
  /** Cor da ficha no quadro. Opcional: quando ausente, a interface deriva uma. */
  color?: string;
}

export type SlotKind = 'sala' | 'apoio' | 'recepcao' | 'cme' | 'almox' | 'almoco';

/** O que uma ASB está fazendo num bloco de 1 hora. */
export interface Slot {
  asbId: Id;
  hour: number;
  kind: SlotKind;
  roomId?: Id;
}

/** Escala base: vale para todos os dias úteis. */
export interface BaseSchedule {
  slots: Slot[];
}

export type RotationPeriod = 'week' | 'month';

export type TaskMode =
  | { mode: 'dentist'; dentistId: Id }
  | { mode: 'room'; roomId: Id; hour: number }
  | { mode: 'rotation'; period: RotationPeriod; order: Id[]; startDate: IsoDate }
  | { mode: 'fixed'; asbIds: Id[] };

export interface Task {
  id: Id;
  name: string;
  when: string;
  rule: string;
  /** Dias da semana em que a tarefa acontece. */
  days: number[];
  assignment: TaskMode;
}

export type AbsenceReason = 'Férias' | 'Atestado' | 'Falta' | 'Folga' | 'Licença' | 'Outro';

export const ABSENCE_REASONS: AbsenceReason[] = ['Férias', 'Atestado', 'Falta', 'Folga', 'Licença', 'Outro'];

export type Substitute = { asbId: Id } | { externalName: string };

export interface Absence {
  id: Id;
  asbId: Id;
  /** Início, inclusivo. */
  from: IsoDate;
  /** Fim, inclusivo. */
  to: IsoDate;
  reason: AbsenceReason;
  substitute?: Substitute;
}

/** Registro de quem está na Prótese e desde quando (regra do cliente: 1 mês fixa). */
export interface ProteseRecord {
  dentistId: Id;
  asbId: Id;
  since: IsoDate;
}

export interface AppData {
  version: number;
  rooms: Room[];
  dentists: Dentist[];
  asbs: Asb[];
  base: BaseSchedule;
  tasks: Task[];
  rules: string[];
  absences: Absence[];
  /** Padrão [1,2,3,4,5]. */
  openDays: number[];
  /** Opcional: histórico da ASB da Prótese para a regra do mês. */
  protese?: ProteseRecord[];
}

/** Blocos de hora do CEO: 07→08 até 18→19. */
export const HOURS: readonly number[] = Object.freeze([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
export const OPEN_START = 7;
export const OPEN_END = 19;

export const SLOT_KIND_LABEL: Record<SlotKind, string> = {
  sala: 'Sala',
  apoio: 'Apoio / Recepção',
  recepcao: 'Apoio / Recepção',
  cme: 'CME / Arsenal',
  almox: 'Almoxarifado',
  almoco: 'Almoço',
};

// ---- Escala efetiva de um dia (seção 5.1) ----

/** Quem ocupa um slot no dia: uma ASB da equipe ou uma pessoa externa. */
export type Person = { type: 'asb'; asbId: Id } | { type: 'external'; name: string };

export type SlotOrigin = 'base' | 'substitute' | 'external';

export interface EffectiveSlot {
  hour: number;
  kind: SlotKind;
  roomId?: Id;
  who: Person;
  origin: SlotOrigin;
  /** Preenchido quando o slot foi herdado de uma ASB ausente. */
  coveringFor?: Id;
}

/** Slot da ausente que ninguém conseguiu cobrir. */
export interface UncoveredSlot {
  slot: Slot;
  absenceId: Id;
  reason: 'sem-substituta' | 'substituta-ausente' | 'substituta-ocupada' | 'substituta-fora-do-contrato';
  /** O que a substituta estava fazendo nesse bloco, se ocupada. */
  busyWith?: SlotKind;
  substituteId?: Id;
}

export interface EffectiveDay {
  date: IsoDate;
  /** 0=dom ... 6=sáb. */
  weekday: number;
  /** false quando o CEO não abre nesse dia da semana. */
  open: boolean;
  slots: EffectiveSlot[];
  /** Ausências que valem nesse dia. */
  absences: Absence[];
  uncovered: UncoveredSlot[];
  /** ASBs ativas e presentes nesse dia. */
  presentAsbIds: Id[];
  /** Dentistas que atendem nesse dia da semana. */
  dentists: Dentist[];
}

// ---- Alertas (seção 5.2) ----

export type AlertLevel = 'critico' | 'aviso';

export type AlertCode =
  | 'sala-sem-asb'
  | 'sem-almoco'
  | 'sala-sem-dentista'
  | 'bloco-sem-atribuicao'
  | 'duas-asbs-mesma-sala'
  | 'substituta-choque'
  | 'ausente-sem-substituta'
  | 'protese-trocou-antes-do-mes';

export interface Alert {
  level: AlertLevel;
  code: AlertCode;
  message: string;
  hour?: number;
  roomId?: Id;
  asbId?: Id;
}
