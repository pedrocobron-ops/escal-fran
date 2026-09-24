import { useMemo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Asb, Person, Task, TaskMode, TaskResolution } from '../../domain';
import { WEEKDAY_LABEL, WEEKDAY_SHORT, formatDate, formatHour, resolveTask, rotationTitular, todayIso, weekdayOf } from '../../domain';
import { newId, useData, useStore } from '../../store/useStore';
import { colorMap } from '../colors';
import { Modal, useConfirm } from '../common/Modal';
import { DaysPicker, Field, HourSelect } from '../common/fields';

export function TasksScreen() {
  const data = useData();
  const apply = useStore((s) => s.apply);
  const confirm = useConfirm();
  const [date, setDate] = useState(todayIso());
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const colors = useMemo(() => colorMap(data.asbs), [data.asbs]);

  const remove = async (t: Task) => {
    const ok = await confirm({ title: 'Remover tarefa?', message: <>A tarefa <strong>{t.name}</strong> será removida.</>, confirmLabel: 'Remover', danger: true });
    if (ok) apply((d) => { d.tasks = d.tasks.filter((x) => x.id !== t.id); });
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Tarefas e rodízios</h1>
        <span className="spacer" />
        <label className="muted small">Resolver para o dia</label>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <span className="muted">{WEEKDAY_LABEL[weekdayOf(date)]}</span>
        <button className="btn primary" onClick={() => setEditing('new')}>Nova tarefa</button>
      </div>
      <div className="cards">
        {data.tasks.map((t) => (
          <TaskCard key={t.id} task={t} date={date} colors={colors} onEdit={() => setEditing(t)} onRemove={() => remove(t)} />
        ))}
      </div>
      {editing && (
        <TaskForm
          task={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(t) => {
            apply((d) => {
              const i = d.tasks.findIndex((x) => x.id === t.id);
              if (i >= 0) d.tasks[i] = t;
              else d.tasks.push(t);
            });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function personLabel(data: ReturnType<typeof useData>, p: Person): string {
  return p.type === 'asb' ? (data.asbs.find((a) => a.id === p.asbId)?.name ?? '?') : `${p.name} (externa)`;
}

function TaskCard({ task, date, colors, onEdit, onRemove }: { task: Task; date: string; colors: Map<string, string>; onEdit: () => void; onRemove: () => void }) {
  const data = useData();
  const apply = useStore((s) => s.apply);
  const res: TaskResolution = resolveTask(data, task, date);
  const a = task.assignment;
  const modeLabel = { dentist: 'Segue o dentista', room: 'Segue a sala', rotation: a.mode === 'rotation' && a.period === 'week' ? 'Rodízio semanal' : 'Rodízio mensal', fixed: 'Fixa' }[a.mode];
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div>
          <h3>{task.name}</h3>
          <div className="muted small">{task.when} · {task.days.map((d) => WEEKDAY_SHORT[d]).join(', ')}</div>
        </div>
        <span className="badge neutral">{modeLabel}</span>
      </div>
      <p className="small" style={{ marginTop: 8 }}>{task.rule}</p>
      <div style={{ marginTop: 8 }}>
        <strong>Em {formatDate(date)}:</strong>{' '}
        {!res.applies ? (
          <span className="muted">{res.reason}</span>
        ) : res.holders.length === 0 ? (
          <span className="error">Ninguém. {res.reason}</span>
        ) : (
          <>
            {res.holders.map((p, i) => (
              <span key={i} className="chip static" style={{ background: p.type === 'asb' ? colors.get(p.asbId) : '#555', marginRight: 4 }}>
                {personLabel(data, p)}
              </span>
            ))}
            <div className="muted small" style={{ marginTop: 4 }}>{res.reason}</div>
          </>
        )}
      </div>
      {a.mode === 'rotation' && <RotationEditor task={task} assignment={a} date={date} colors={colors} onChange={(next) => apply((d) => { const t = d.tasks.find((x) => x.id === task.id); if (t) t.assignment = next; })} />}
      <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
        <button className="btn sm" onClick={onEdit}>Editar</button>
        <button className="btn sm danger" onClick={onRemove}>Remover</button>
      </div>
    </div>
  );
}

type Rotation = Extract<TaskMode, { mode: 'rotation' }>;

function RotationEditor({ task, assignment, date, colors, onChange }: { task: Task; assignment: Rotation; date: string; colors: Map<string, string>; onChange: (a: Rotation) => void }) {
  const data = useData();
  const titular = rotationTitular(assignment, date);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = assignment.order.indexOf(String(e.active.id));
    const to = assignment.order.indexOf(String(e.over.id));
    if (from < 0 || to < 0) return;
    onChange({ ...assignment, order: arrayMove(assignment.order, from, to) });
  };
  const notInOrder = data.asbs.filter((a) => a.active && !assignment.order.includes(a.id));
  return (
    <div style={{ marginTop: 10 }}>
      <div className="field-row">
        <Field label="Início do rodízio">
          <input type="date" value={assignment.startDate} onChange={(e) => e.target.value && onChange({ ...assignment, startDate: e.target.value })} />
        </Field>
        <Field label="Período">
          <select value={assignment.period} onChange={(e) => onChange({ ...assignment, period: e.target.value as Rotation['period'] })}>
            <option value="week">Semanal (segunda a sexta)</option>
            <option value="month">Mensal</option>
          </select>
        </Field>
      </div>
      <div className="muted small" style={{ marginBottom: 4 }}>Ordem do rodízio (arraste para reordenar). {task.days.length > 0 ? '' : ''}</div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={assignment.order} strategy={verticalListSortingStrategy}>
          <div className="sortable-list">
            {assignment.order.map((id, i) => {
              const asb = data.asbs.find((a) => a.id === id);
              return (
                <SortableRow key={id} id={id} titular={id === titular} index={i} asb={asb} color={colors.get(id) ?? '#555'} onRemove={() => onChange({ ...assignment, order: assignment.order.filter((x) => x !== id) })} />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      {notInOrder.length > 0 && (
        <div className="toolbar" style={{ marginTop: 6, marginBottom: 0 }}>
          <select
            value=""
            onChange={(e) => e.target.value && onChange({ ...assignment, order: [...assignment.order, e.target.value] })}
            aria-label="Adicionar ASB ao rodízio"
          >
            <option value="">Adicionar ao rodízio...</option>
            {notInOrder.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function SortableRow({ id, titular, index, asb, color, onRemove }: { id: string; titular: boolean; index: number; asb?: Asb; color: string; onRemove: () => void }) {
  const s = useSortable({ id });
  const style = { transform: CSS.Transform.toString(s.transform), transition: s.transition, opacity: s.isDragging ? 0.5 : 1 };
  return (
    <div ref={s.setNodeRef} style={style} className={`sortable-item${titular ? ' titular' : ''}`} {...s.attributes} {...s.listeners}>
      <span className="handle" aria-hidden>⋮⋮</span>
      <span className="muted small">{index + 1}.</span>
      <span className="chip static" style={{ background: color }}>{asb?.name ?? id}</span>
      {titular && <span className="badge ok">titular da vez</span>}
      {asb && !asb.active && <span className="badge neutral">inativa</span>}
      <span style={{ flex: 1 }} />
      <button type="button" className="btn sm icon" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} onClick={onRemove} aria-label="Tirar do rodízio">×</button>
    </div>
  );
}

function TaskForm({ task, onClose, onSave }: { task?: Task; onClose: () => void; onSave: (t: Task) => void }) {
  const data = useData();
  const [name, setName] = useState(task?.name ?? '');
  const [when, setWhen] = useState(task?.when ?? '');
  const [rule, setRule] = useState(task?.rule ?? '');
  const [days, setDays] = useState<number[]>(task?.days ?? [1, 2, 3, 4, 5]);
  const [assignment, setAssignment] = useState<TaskMode>(
    task?.assignment ?? { mode: 'dentist', dentistId: data.dentists[0]?.id ?? '' },
  );
  const [error, setError] = useState<string | null>(null);

  const setMode = (mode: TaskMode['mode']) => {
    if (mode === assignment.mode) return;
    if (mode === 'dentist') setAssignment({ mode, dentistId: data.dentists[0]?.id ?? '' });
    if (mode === 'room') setAssignment({ mode, roomId: data.rooms[0]?.id ?? '', hour: 8 });
    if (mode === 'rotation') setAssignment({ mode, period: 'week', order: data.asbs.filter((a) => a.active).map((a) => a.id), startDate: todayIso() });
    if (mode === 'fixed') setAssignment({ mode, asbIds: [] });
  };

  const submit = () => {
    if (!name.trim()) return setError('Dê um nome para a tarefa.');
    if (days.length === 0) return setError('Escolha pelo menos um dia.');
    if (assignment.mode === 'dentist' && !assignment.dentistId) return setError('Escolha o dentista.');
    if (assignment.mode === 'room' && !assignment.roomId) return setError('Escolha a sala.');
    onSave({ id: task?.id ?? newId('task'), name: name.trim(), when: when.trim(), rule: rule.trim(), days, assignment });
  };

  return (
    <Modal title={task ? 'Editar tarefa' : 'Nova tarefa'} onClose={onClose} wide>
      <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Quando (texto livre, ex.: Diário, 07h às 08h)"><input value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <Field label="Regra (como aparece no PDF)"><textarea rows={2} value={rule} onChange={(e) => setRule(e.target.value)} /></Field>
      <Field label="Dias em que acontece"><DaysPicker value={days} onChange={setDays} /></Field>
      <Field label="Quem faz">
        <select value={assignment.mode} onChange={(e) => setMode(e.target.value as TaskMode['mode'])}>
          <option value="dentist">Segue o dentista (quem estiver escalada com ele)</option>
          <option value="room">Segue a sala (quem estiver na sala num horário)</option>
          <option value="rotation">Rodízio (semanal ou mensal)</option>
          <option value="fixed">Lista fixa</option>
        </select>
      </Field>
      {assignment.mode === 'dentist' && (
        <Field label="Dentista">
          <select value={assignment.dentistId} onChange={(e) => setAssignment({ mode: 'dentist', dentistId: e.target.value })}>
            {data.dentists.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.specialty})</option>)}
          </select>
        </Field>
      )}
      {assignment.mode === 'room' && (
        <div className="field-row">
          <Field label="Sala">
            <select value={assignment.roomId} onChange={(e) => setAssignment({ ...assignment, roomId: e.target.value })}>
              {data.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Horário de referência">
            <HourSelect value={assignment.hour} onChange={(hour) => setAssignment({ ...assignment, hour })} max={18} />
          </Field>
        </div>
      )}
      {assignment.mode === 'rotation' && (
        <p className="muted small">A ordem, o período e a data de início se ajustam no card da tarefa depois de salvar. Início atual: {formatDate(assignment.startDate)}.</p>
      )}
      {assignment.mode === 'fixed' && (
        <Field label="ASBs responsáveis">
          <div className="checks">
            {data.asbs.filter((a) => a.active).map((a) => (
              <label key={a.id}>
                <input
                  type="checkbox"
                  checked={assignment.asbIds.includes(a.id)}
                  onChange={(e) => setAssignment({ mode: 'fixed', asbIds: e.target.checked ? [...assignment.asbIds, a.id] : assignment.asbIds.filter((x) => x !== a.id) })}
                />{' '}
                {a.name}
              </label>
            ))}
          </div>
        </Field>
      )}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={submit}>Salvar</button>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>Horários de referência usam blocos de {formatHour(7)} a {formatHour(18)}.</p>
    </Modal>
  );
}
