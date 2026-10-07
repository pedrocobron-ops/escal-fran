// Voz no navegador: ditar a pergunta (Web Speech API) e ler a resposta em voz alta.
// Funciona no Chrome, Edge e Safari; em outros navegadores os botões ficam escondidos.

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionCtor(): (new () => RecognitionLike) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function dictationSupported(): boolean {
  return typeof window !== 'undefined' && recognitionCtor() !== undefined;
}

/** Começa a ouvir; devolve a função que para. `onText` recebe o texto parcial e final. */
export function startDictation(handlers: { onText: (text: string, final: boolean) => void; onEnd: () => void; onError: (msg: string) => void }): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    handlers.onError('Este navegador não entende voz. Use o Chrome ou o Safari.');
    handlers.onEnd();
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = 'pt-BR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    let text = '';
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      if (e.results[i].isFinal) final = true;
    }
    handlers.onText(text.trim(), final);
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') handlers.onError('O navegador não deixou usar o microfone. Libere o microfone para este site.');
    else if (e.error === 'no-speech') handlers.onError('Não ouvi nada. Tente de novo.');
    else if (e.error !== 'aborted') handlers.onError('Não consegui entender. Tente de novo ou escreva.');
  };
  rec.onend = () => handlers.onEnd();
  try {
    rec.start();
  } catch {
    handlers.onError('Não consegui ligar o microfone.');
    handlers.onEnd();
  }
  return () => {
    try {
      rec.stop();
    } catch {
      // já parou
    }
  };
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function speak(text: string): void {
  if (!speechSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'pt-BR';
  const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith('pt-br')) ?? synth.getVoices().find((v) => v.lang.toLowerCase().startsWith('pt'));
  if (voice) u.voice = voice;
  u.rate = 1.05;
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}
