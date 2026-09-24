import type { Alert } from '../../domain';

export function AlertsPanel({ alerts, title = 'Alertas' }: { alerts: Alert[]; title?: string }) {
  const sorted = [...alerts].sort((a, b) => (a.level === b.level ? 0 : a.level === 'critico' ? -1 : 1));
  const criticos = alerts.filter((a) => a.level === 'critico').length;
  const avisos = alerts.length - criticos;
  return (
    <section className="alerts card">
      <h3>
        {title}{' '}
        {alerts.length === 0 ? (
          <span className="badge ok">Tudo certo</span>
        ) : (
          <>
            {criticos > 0 && <span className="badge critico">{criticos} crítico{criticos > 1 ? 's' : ''}</span>}{' '}
            {avisos > 0 && <span className="badge aviso">{avisos} aviso{avisos > 1 ? 's' : ''}</span>}
          </>
        )}
      </h3>
      {alerts.length === 0 ? (
        <p className="muted">Nenhum alerta nesta escala.</p>
      ) : (
        <ul className="alert-list">
          {sorted.map((a, i) => (
            <li key={i} className={a.level}>
              {a.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
