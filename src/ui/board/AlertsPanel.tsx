import type { Alert } from '../../domain';

export function AlertsPanel({ alerts, title = 'Alertas' }: { alerts: Alert[]; title?: string }) {
  const rank = { critico: 0, aviso: 1, info: 2 };
  const sorted = [...alerts].sort((a, b) => rank[a.level] - rank[b.level]);
  const criticos = alerts.filter((a) => a.level === 'critico').length;
  const avisos = alerts.filter((a) => a.level === 'aviso').length;
  const infos = alerts.filter((a) => a.level === 'info').length;
  return (
    <section className="alerts card">
      <h3>
        {title}{' '}
        {criticos + avisos === 0 ? (
          <span className="badge ok">Tudo certo</span>
        ) : (
          <>
            {criticos > 0 && <span className="badge critico">{criticos} crítico{criticos > 1 ? 's' : ''}</span>}{' '}
            {avisos > 0 && <span className="badge aviso">{avisos} aviso{avisos > 1 ? 's' : ''}</span>}
          </>
        )}{' '}
        {infos > 0 && <span className="badge info">{infos} remanejamento{infos > 1 ? 's' : ''} ou folga{infos > 1 ? 's' : ''}</span>}
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
