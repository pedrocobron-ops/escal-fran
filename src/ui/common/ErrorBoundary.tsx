import { Component, type ReactNode } from 'react';
import { STORAGE_KEY } from '../../store/storage';

interface State {
  error: Error | null;
}

/** Tela de erro com saída: exportar o que está salvo e voltar para a escala inicial. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  private exportRaw = () => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    const blob = new Blob([raw ?? '{}'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'escala-ceo-dados-com-problema.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  private reset = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // sem localStorage não há o que limpar
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-main">
        <div className="card" style={{ maxWidth: 640, margin: '48px auto' }}>
          <h2>Algo deu errado ao mostrar a escala</h2>
          <p className="muted small">Isso costuma acontecer quando os dados salvos ficaram inconsistentes, por exemplo depois de importar um backup antigo.</p>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', background: '#f4f5f7', padding: 8, borderRadius: 6 }}>{this.state.error.message}</pre>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <button className="btn" onClick={() => window.location.reload()}>Tentar de novo</button>
            <button className="btn" onClick={this.exportRaw}>Salvar os dados atuais em arquivo</button>
            <button className="btn danger" onClick={this.reset}>Voltar para a escala inicial</button>
          </div>
        </div>
      </main>
    );
  }
}
