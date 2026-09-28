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

/**
 * O que uma ASB está fazendo num bloco de 1 hora. `roomId` vale para `sala` e
 * para `apoio` de uma sala específica (ASB de apoio dentro daquela sala, que não
 * conta como a ASB da sala).
 */
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

/** Hora extra: a ASB trabalha fora do contrato numa data (entrar mais cedo para pagar hora, por exemplo). */
export interface ExtraShift {
  id: Id;
  asbId: Id;
  date: IsoDate;
  start: number;
  end: number;
  note?: string;
  /** Quando a hora extra foi criada para cobrir uma ausência, o id dela. */
  absenceId?: Id;
}

/** Folga ou ausência de dentista: nesses dias ele não atende e a ASB dele fica livre. */
export interface DentistAbsence {
  id: Id;
  dentistId: Id;
  from: IsoDate;
  to: IsoDate;
  reason: AbsenceReason;
}

/** `livre` só existe em ajuste de dia: "nesse dia, nessa hora, a ASB não tem atribuição". */
export type DaySlotKind = SlotKind | 'livre';

/** Ajuste de um dia específico: substitui o que a ASB faria nessa hora na escala base. */
export interface DaySlot {
  id: Id;
  date: IsoDate;
  asbId: Id;
  hour: number;
  kind: DaySlotKind;
  roomId?: Id;
}

/** Campos da estrutura da escala que mudam com o tempo e precisam de histórico. */
export const STRUCTURE_KEYS = ['rooms', 'dentists', 'asbs', 'base', 'tasks', 'openDays'] as const;
export type StructureKey = (typeof STRUCTURE_KEYS)[number];

/**
 * Como a estrutura estava até `until` (inclusivo). Guarda só os campos que
 * mudaram logo depois dessa data; os outros seguem iguais ao próximo registro.
 */
export interface StructureSnapshot {
  until: IsoDate;
  rooms?: Room[];
  dentists?: Dentist[];
  asbs?: Asb[];
  base?: BaseSchedule;
  tasks?: Task[];
  openDays?: number[];
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
  /** Horas extras por data. */
  extraShifts?: ExtraShift[];
  /** Folgas e ausências de dentistas. */
  dentistAbsences?: DentistAbsence[];
  /** Ajustes feitos no Modo Dia, por data. */
  dayOverrides?: DaySlot[];
  /** Histórico da estrutura, do mais antigo para o mais recente. */
  history?: StructureSnapshot[];
  /** Primeiro dia em que o app registrou a escala neste navegador. */
  historySince?: IsoDate;
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

/** base: da escala base; substitute: herdado de uma ausente; external: pessoa de fora;
 *  override: ajuste feito para esse dia; auto: remanejada pelo app (dentista de folga ou hora extra). */
export type SlotOrigin = 'base' | 'substitute' | 'external' | 'override' | 'auto';

export interface EffectiveSlot {
  hour: number;
  kind: SlotKind;
  roomId?: Id;
  who: Person;
  origin: SlotOrigin;
  /** Preenchido quando o slot foi herdado de uma ASB ausente. */
  coveringFor?: Id;
  /** Remanejamento automático: sala de onde a ASB saiu (se estava numa sala). */
  movedFrom?: Id;
  /** true quando o bloco está dentro de uma hora extra da ASB nessa data. */
  extra?: boolean;
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
  /** Dentistas que atendem nesse dia (dia da semana e sem folga). */
  dentists: Dentist[];
  /** Dentistas que atenderiam nesse dia da semana mas estão de folga. */
  dentistsOff: Dentist[];
  dentistAbsences: DentistAbsence[];
  extraShifts: ExtraShift[];
  overrides: DaySlot[];
}

// ---- Alertas (seção 5.2) ----

export type AlertLevel = 'critico' | 'aviso' | 'info';

export type AlertCode =
  | 'sala-sem-asb'
  | 'sem-almoco'
  | 'sala-sem-dentista'
  | 'bloco-sem-atribuicao'
  | 'duas-asbs-mesma-sala'
  | 'substituta-choque'
  | 'ausente-sem-substituta'
  | 'protese-trocou-antes-do-mes'
  | 'asb-duas-salas'
  | 'hora-extra-sem-atribuicao'
  | 'dentista-de-folga'
  | 'remanejada';

export interface Alert {
  level: AlertLevel;
  code: AlertCode;
  message: string;
  hour?: number;
  roomId?: Id;
  asbId?: Id;
}
