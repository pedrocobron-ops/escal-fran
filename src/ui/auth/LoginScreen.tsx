import { useEffect, useState, type FormEvent } from 'react';
import { AuthError, parseRecoveryHash, type AuthClient } from '../../store/auth';

type Mode = 'login' | 'recover' | 'sent' | 'new-password';

/** Último e-mail usado neste aparelho, para não digitar de novo. */
const LAST_EMAIL_KEY = 'escala-ceo:ultimo-email';
function readLastEmail(): string {
  try {
    return window.localStorage.getItem(LAST_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}
function writeLastEmail(email: string): void {
  try {
    window.localStorage.setItem(LAST_EMAIL_KEY, email.trim());
  } catch {
    // sem localStorage
  }
}

/** Tela de entrada: e-mail e senha da conta, "esqueci a senha" e a troca de senha pelo link do e-mail. */
export function LoginScreen({ auth, onDone }: { auth: AuthClient; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState(readLastEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Voltou do link "esqueci a senha": o endereço traz uma sessão temporária para trocar a senha.
  useEffect(() => {
    const s = parseRecoveryHash(window.location.hash);
    if (!s) return;
    auth.adopt(s);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setMode('new-password');
    void auth.whoami().then((u) => setEmail(u.email)).catch(() => undefined);
  }, [auth]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof AuthError ? e.message : 'Algo deu errado. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  const login = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return setError('Preencha o e-mail e a senha.');
    void run(async () => {
      await auth.login(email, password);
      writeLastEmail(email);
      onDone();
    });
  };

  const recover = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setError('Digite o e-mail da conta.');
    void run(async () => {
      await auth.recover(email, window.location.origin + window.location.pathname);
      setMode('sent');
    });
  };

  const changePassword = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.');
    if (password !== confirm) return setError('As duas senhas não são iguais.');
    void run(async () => {
      await auth.updatePassword(password);
      onDone();
    });
  };

  return (
    <div className="login-wrap">
      <form className="login-card card" onSubmit={mode === 'login' ? login : mode === 'recover' ? recover : mode === 'new-password' ? changePassword : (e) => e.preventDefault()}>
        <div className="login-brand">
          <span className="login-mark" aria-hidden>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="3" />
              <path d="M3 10h18M8 3v4M16 3v4" />
              <path d="M8 15l2.5 2.5L16 13" />
            </svg>
          </span>
          <div>
            <h1>Escala CEO</h1>
            <p className="sub">Escala das ASBs e dentistas</p>
          </div>
        </div>
        {mode === 'login' && (
          <>
            <p className="lead">Entre com o e-mail e a senha da sua conta. A escala fica guardada nela e aparece igual em qualquer computador ou celular.</p>
            <div className="field"><label htmlFor="login-email">E-mail</label><input id="login-email" type="email" autoComplete="username" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!email} /></div>
            <div className="field"><label htmlFor="login-senha">Senha</label><input id="login-senha" type="password" autoComplete="current-password" placeholder="Sua senha" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={!!email} /></div>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Entrando...' : 'Entrar'}</button>
            <div className="login-links">
              <button type="button" className="btn link" onClick={() => { setMode('recover'); setError(null); }}>Esqueci a senha</button>
            </div>
            <p className="login-foot">Você só entra uma vez: este aparelho continua conectado até você clicar em "Sair da conta", em Ajustes.</p>
          </>
        )}
        {mode === 'recover' && (
          <>
            <p className="lead">Digite o e-mail da conta. Você recebe um link para criar uma senha nova.</p>
            <div className="field"><label htmlFor="rec-email">E-mail</label><input id="rec-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></div>
            {error && <p className="error">{error}</p>}
            <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="btn link" onClick={() => { setMode('login'); setError(null); }}>Voltar</button>
              <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Enviando...' : 'Enviar o link'}</button>
            </div>
          </>
        )}
        {mode === 'sent' && (
          <>
            <p>Se existe uma conta com o e-mail <strong>{email}</strong>, o link para criar a senha nova foi enviado. Abra o e-mail neste mesmo aparelho e toque no link.</p>
            <p className="muted small">Não chegou? Confira a caixa de spam ou peça ajuda a quem cuida do app, que pode definir uma senha nova pelo painel.</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => { setMode('login'); setError(null); }}>Voltar</button>
            </div>
          </>
        )}
        {mode === 'new-password' && (
          <>
            <p className="lead">Crie a senha nova{email ? ` para ${email}` : ''}.</p>
            <div className="field"><label htmlFor="np1">Senha nova</label><input id="np1" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></div>
            <div className="field"><label htmlFor="np2">Repita a senha</label><input id="np2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
            {error && <p className="error">{error}</p>}
            <div className="modal-actions">
              <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar e entrar'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
