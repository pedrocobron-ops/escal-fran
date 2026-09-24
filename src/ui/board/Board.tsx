import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { Alert, Asb, EffectiveDay, EffectiveSlot, IsoDate } from '../../domain';
import {
  HOURS, WEEKDAY_LABEL, analyze, baseDay, canAssign, dentistsAt, effectiveDay, formatBlock, formatDate, formatHour, formatRange,
  isExternalSubstitute, isTeamSubstitute, proteseAlerts, todayIso, validHours, weekdayOf,
} from '../../domain';
import { removeSlot, setSlots, useData, useStore, clearSchedule } from '../../store/useStore';
import { colorMap, tint } from '../colors';
import { useConfirm } from '../common/Modal';
import { AlertsPanel } from './AlertsPanel';
import { Chip, ChipOverlay, type DragItem } from './Chip';
import { RangeDialog } from './RangeDialog';
import { cellKey, columnKeyOf, columnsFor, type Column } from './model';

type Mode = 'base' | 'day';

interface CellData {
  type: 'cell';
  column: Column;
  hour: number;
}

interface PaletteDrop {
  type: 'palette';
}

type DropData = CellData | PaletteDrop;

interface PendingRange {
  asbId: string;
  column: Column;
  fromHour: number;
  origHour?: number;
}

const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

export function Board() {
  const data = useData();
  const apply = useStore((s) => s.apply);
  const confirm = useConfirm();
  const [mode, setMode] = useState<Mode>('base');
  const [date, setDate] = useState<IsoDate>(todayIso());
  const [rangeMode, setRangeMode] = useState(false);
  const [active, setActive] = useState<DragItem | null>(null);
  const [pending, setPending] = useState<PendingRange | null>(null);
  const shiftRef = useRef(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftRef.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftRef.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const readOnly = mode === 'day';
  const columns = useMemo(() => columnsFor(data), [data]);
  const colors = useMemo(() => colorMap(data.asbs), [data.asbs]);
  const asbById = useMemo(() => new Map(data.asbs.map((a) => [a.id, a])), [data.asbs]);
  const day: EffectiveDay = useMemo(() => (mode === 'base' ? baseDay(data) : effectiveDay(data, date)), [data, mode, date]);
  const alerts: Alert[] = useMemo(
    () => (mode === 'base' ? [...analyze(data, day), ...proteseAlerts(data, todayIso())] : analyze(data, day)),
    [data, day, mode],
  );

  const slotsByCell = useMemo(() => {
    const m = new Map<string, EffectiveSlot[]>();
    for (const s of day.slots) {
      const k = cellKey(columnKeyOf(s), s.hour);
      const list = m.get(k) ?? [];
      list.push(s);
      m.set(k, list);
    }
    return m;
  }, [day]);

  const cellAlerts = useMemo(() => {
    const m = new Map<string, Alert['level']>();
    for (const a of alerts) {
      if (a.roomId === undefined || a.hour === undefined) continue;
      const k = cellKey(`sala:${a.roomId}`, a.hour);
      const cur = m.get(k);
      if (cur !== 'critico') m.set(k, a.level);
    }
    return m;
  }, [alerts]);

  const activeAsb: Asb | undefined = active ? asbById.get(active.asbId) : undefined;

  const sensors = useSensors(
    // Mouse e toque separados: no toque, segurar 200 ms começa o arrasto e
    // deslizar antes disso rola a tela normalmente.
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = (e: DragStartEvent) => {
    const item = e.active.data.current as DragItem | undefined;
    setActive(item ?? null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const item = e.active.data.current as DragItem | undefined;
    const over = e.over?.data.current as DropData | undefined;
    const wantRange = rangeMode || shiftRef.current;
    setActive(null);
    if (!item || !over) return;
    const asb = asbById.get(item.asbId);
    if (!asb) return;
    if (over.type === 'palette') {
      if (item.type === 'slot') apply((d) => removeSlot(d, item.asbId, item.hour));
      return;
    }
    if (!canAssign(asb, over.hour)) return;
    const origHour = item.type === 'slot' ? item.hour : undefined;
    if (wantRange && over.hour + 1 < asb.end) {
      setPending({ asbId: asb.id, column: over.column, fromHour: over.hour, origHour });
      return;
    }
    apply((d) => {
      if (origHour !== undefined && origHour !== over.hour) removeSlot(d, asb.id, origHour);
      setSlots(d, asb.id, [over.hour], { kind: over.column.kind, roomId: over.column.roomId });
    });
  };

  const applyRange = (endHour: number) => {
    if (!pending) return;
    const hours: number[] = [];
    for (let h = pending.fromHour; h < endHour; h++) hours.push(h);
    apply((d) => {
      if (pending.origHour !== undefined && !hours.includes(pending.origHour)) removeSlot(d, pending.asbId, pending.origHour);
      setSlots(d, pending.asbId, hours, { kind: pending.column.kind, roomId: pending.column.roomId });
    });
    setPending(null);
  };

  const onClear = async () => {
    const ok = await confirm({
      title: 'Limpar a escala base?',
      message: 'Todas as fichas do quadro serão removidas. Dá para desfazer com Ctrl+Z.',
      confirmLabel: 'Limpar',
      danger: true,
    });
    if (ok) apply(clearSchedule);
  };

  const removeChip = useCallback((asbId: string, hour: number) => apply((d) => removeSlot(d, asbId, hour)), [apply]);

  const isEmpty = data.asbs.length === 0 && data.base.slots.length === 0;
  if (isEmpty) return <EmptyState />;

  return (
    <div>
      <div className="toolbar">
        <div className="btn-group" style={{ display: 'flex', gap: 4 }}>
          <button className={`btn${mode === 'base' ? ' active' : ''}`} onClick={() => setMode('base')}>Escala base</button>
          <button className={`btn${mode === 'day' ? ' active' : ''}`} onClick={() => setMode('day')}>Modo Dia</button>
        </div>
        {mode === 'day' && (
          <>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Data" />
            <span className="muted">
              {WEEKDAY_LABEL[weekdayOf(date)]}, {formatDate(date)}
              {!day.open && ' (CEO fechado)'}
            </span>
          </>
        )}
        {mode === 'base' && (
          <>
            <button className={`btn${rangeMode ? ' active' : ''}`} onClick={() => setRangeMode((v) => !v)} title="Ao soltar a ficha, pergunta até que horas preencher">
              Preencher em faixa
            </button>
            <span className="muted small hint-shift">ou segure Shift ao soltar</span>
            <span className="spacer" />
            <UndoRedo />
            <button className="btn danger" onClick={onClear} disabled={data.base.slots.length === 0}>Limpar escala</button>
          </>
        )}
      </div>

      {mode === 'day' && <DaySummary day={day} data={data} />}

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div className="board-layout">
          <div className="board-scroll">
            <div className="board" style={{ gridTemplateColumns: `var(--hour-w) repeat(${columns.length}, minmax(var(--cell-min), 1fr))` }}>
              <div className="hcell">Hora</div>
              {columns.map((c) => (
                <div key={c.key} className="hcell" style={c.color ? { background: tint(c.color, 0.8) } : undefined}>
                  {c.label}
                </div>
              ))}
              {HOURS.map((hour) => (
                <RowCells
                  key={hour}
                  hour={hour}
                  columns={columns}
                  day={day}
                  slotsByCell={slotsByCell}
                  cellAlerts={cellAlerts}
                  activeAsb={activeAsb}
                  colors={colors}
                  asbById={asbById}
                  readOnly={readOnly}
                  onRemove={removeChip}
                />
              ))}
            </div>
          </div>
          <Palette day={day} asbs={data.asbs} colors={colors} readOnly={readOnly} active={active} alerts={alerts} />
        </div>
        <DragOverlay dropAnimation={null}>
          {activeAsb ? <ChipOverlay label={activeAsb.name} color={colors.get(activeAsb.id) ?? '#555'} /> : null}
        </DragOverlay>
      </DndContext>

      <AlertsPanel alerts={alerts} title={mode === 'base' ? 'Alertas da escala base' : `Alertas de ${formatDate(date)}`} />

      {pending && asbById.get(pending.asbId) && (
        <RangeDialog
          asb={asbById.get(pending.asbId)!}
          column={pending.column}
          fromHour={pending.fromHour}
          onPick={applyRange}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}

interface RowProps {
  hour: number;
  columns: Column[];
  day: EffectiveDay;
  slotsByCell: Map<string, EffectiveSlot[]>;
  cellAlerts: Map<string, Alert['level']>;
  activeAsb?: Asb;
  colors: Map<string, string>;
  asbById: Map<string, Asb>;
  readOnly: boolean;
  onRemove: (asbId: string, hour: number) => void;
}

function RowCells({ hour, columns, day, slotsByCell, cellAlerts, activeAsb, colors, asbById, readOnly, onRemove }: RowProps) {
  return (
    <>
      <div className="hour" title={formatBlock(hour)}>
        <span className="hour-full">{formatBlock(hour)}</span>
        <span className="hour-short">{formatHour(hour)}</span>
      </div>
      {columns.map((c) => (
        <Cell
          key={c.key}
          column={c}
          hour={hour}
          day={day}
          slots={slotsByCell.get(cellKey(c.key, hour)) ?? []}
          alertLevel={cellAlerts.get(cellKey(c.key, hour))}
          activeAsb={activeAsb}
          colors={colors}
          asbById={asbById}
          readOnly={readOnly}
          onRemove={onRemove}
        />
      ))}
    </>
  );
}

interface CellProps {
  column: Column;
  hour: number;
  day: EffectiveDay;
  slots: EffectiveSlot[];
  alertLevel?: Alert['level'];
  activeAsb?: Asb;
  colors: Map<string, string>;
  asbById: Map<string, Asb>;
  readOnly: boolean;
  onRemove: (asbId: string, hour: number) => void;
}

function Cell({ column, hour, day, slots, alertLevel, activeAsb, colors, asbById, readOnly, onRemove }: CellProps) {
  const valid = activeAsb ? canAssign(activeAsb, hour) : undefined;
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${column.key}:${hour}`,
    data: { type: 'cell', column, hour } satisfies CellData,
    disabled: readOnly || valid === false,
  });
  const dentists = column.roomId ? dentistsAt(day.dentists, column.roomId, hour) : [];
  const noDentist = column.kind === 'sala' && dentists.length === 0;
  const cls = [
    'cell',
    readOnly ? 'readonly' : '',
    valid === true ? (noDentist ? 'valid no-dentist' : 'valid') : valid === false ? 'invalid' : '',
    isOver && valid ? 'over' : '',
    alertLevel ? `alert-${alertLevel}` : '',
  ].join(' ');
  const bg = column.color && !alertLevel && valid === undefined ? tint(column.color, 0.93) : undefined;
  return (
    <div ref={setNodeRef} className={cls} style={{ background: bg }} title={valid && noDentist ? 'Sala sem dentista neste bloco: aceita, mas gera aviso' : undefined}>
      {column.kind === 'sala' &&
        (dentists.length > 0 ? (
          <div className="dentist">{dentists.map((d) => `${d.name} (${d.specialty})`).join(', ')}</div>
        ) : (
          <div className="dentist empty">sala vazia</div>
        ))}
      <div className="chips">
        {slots.map((s, i) => {
          if (s.who.type === 'external') {
            const covering = s.coveringFor ? asbById.get(s.coveringFor)?.name : undefined;
            return <Chip key={`ext-${i}`} id={`ext:${column.key}:${hour}:${i}`} label={s.who.name} color="#555" external tag={covering ? `cobre ${covering}` : 'externa'} />;
          }
          const asb = asbById.get(s.who.asbId);
          if (!asb) return null;
          const covering = s.coveringFor ? asbById.get(s.coveringFor)?.name : undefined;
          return (
            <Chip
              key={asb.id}
              id={`slot:${asb.id}:${hour}`}
              label={asb.name}
              color={colors.get(asb.id) ?? '#555'}
              tag={covering ? `cobre ${covering}` : undefined}
              item={readOnly ? undefined : { type: 'slot', asbId: asb.id, hour }}
              disabled={readOnly}
              onRemove={readOnly ? undefined : () => onRemove(asb.id, hour)}
              title={`${asb.name}, ${formatRange(asb.start, asb.end)}`}
            />
          );
        })}
      </div>
    </div>
  );
}

interface PaletteProps {
  day: EffectiveDay;
  asbs: Asb[];
  colors: Map<string, string>;
  readOnly: boolean;
  active: DragItem | null;
  alerts: Alert[];
}

function Palette({ day, asbs, colors, readOnly, active, alerts }: PaletteProps) {
  const { setNodeRef, isOver } = useDroppable({ id: 'palette', data: { type: 'palette' } satisfies PaletteDrop, disabled: readOnly || active?.type !== 'slot' });
  const sorted = [...asbs].filter((a) => a.active).sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
  const absenceOf = (id: string) => day.absences.find((x) => x.asbId === id);
  const lunchAlert = new Set(alerts.filter((a) => a.code === 'sem-almoco').map((a) => a.asbId));
  return (
    <aside ref={setNodeRef} className={`palette${isOver ? ' drop-target' : ''}`}>
      <div className="card">
        <h3>ASBs</h3>
        <p className="muted small">
          {readOnly ? 'Modo Dia é somente leitura.' : active?.type === 'slot' ? 'Solte aqui para remover.' : 'Arraste uma ficha para o quadro. No celular, segure a ficha antes de arrastar.'}
        </p>
        <div className="palette-list">
          {sorted.map((asb) => {
            const abs = absenceOf(asb.id);
            const hours = new Set(day.slots.filter((s) => s.who.type === 'asb' && s.who.asbId === asb.id).map((s) => s.hour));
            const total = validHours(asb).length;
            const filled = [...hours].filter((h) => canAssign(asb, h)).length;
            const color = colors.get(asb.id) ?? '#555';
            return (
              <div key={asb.id} className={`palette-item${abs ? ' absent' : ''}`}>
                <Chip id={`pal:${asb.id}`} label={asb.name} color={color} item={readOnly || abs ? undefined : { type: 'palette', asbId: asb.id }} disabled={readOnly || !!abs} />
                <div className="meta">
                  <span>{formatRange(asb.start, asb.end)}{asb.lunch ? '' : ', sem almoço'}</span>
                  <span className={lunchAlert.has(asb.id) ? 'error' : undefined}>{filled} de {total} blocos</span>
                </div>
                {abs ? (
                  <div className="small muted">
                    Ausente ({abs.reason}).{' '}
                    {isTeamSubstitute(abs) ? `Cobre: ${asbs.find((a) => a.id === abs.substitute.asbId)?.name ?? '?'}` : isExternalSubstitute(abs) ? `Cobre: ${abs.substitute.externalName} (externa)` : 'Sem substituta.'}
                  </div>
                ) : (
                  <div className={`meter${filled >= total && total > 0 ? ' full' : ''}`}>
                    <div style={{ width: `${total ? Math.min(100, (filled / total) * 100) : 0}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function DaySummary({ day, data }: { day: EffectiveDay; data: ReturnType<typeof useData> }) {
  if (!day.open) return <p className="card muted">O CEO não abre neste dia da semana. Ajuste os dias de funcionamento em Ajustes.</p>;
  if (day.absences.length === 0) return <p className="muted small">Sem ausências nesta data. A escala do dia é igual à base.</p>;
  const name = (id: string) => data.asbs.find((a) => a.id === id)?.name ?? id;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h3>Ausências do dia</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {day.absences.map((a) => (
          <li key={a.id}>
            <strong>{name(a.asbId)}</strong>: {a.reason}.{' '}
            {isTeamSubstitute(a) ? `Cobre ${name(a.substitute.asbId)}.` : isExternalSubstitute(a) ? `Cobre ${a.substitute.externalName} (externa).` : 'Sem substituta.'}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function UndoRedo() {
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  return (
    <>
      <button className="btn" onClick={undo} disabled={past === 0} title="Ctrl+Z">Desfazer</button>
      <button className="btn" onClick={redo} disabled={future === 0} title="Ctrl+Shift+Z">Refazer</button>
    </>
  );
}

function EmptyState() {
  const resetToSeed = useStore((s) => s.resetToSeed);
  return (
    <div className="card empty-state">
      <h2>Nenhuma escala cadastrada</h2>
      <p className="muted">Comece pela escala montada a partir dos documentos do CEO. Depois é só ajustar no quadro.</p>
      <button className="btn primary" onClick={resetToSeed}>Carregar escala inicial dos documentos</button>
    </div>
  );
}
