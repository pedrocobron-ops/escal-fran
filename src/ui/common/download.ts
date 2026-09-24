/** Baixa um Blob com nome de arquivo. Devolve a URL para um link de fallback; revogue depois. */
export function downloadBlob(blob: Blob, name: string): string {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    // alguns navegadores bloqueiam o clique programático; o chamador mostra o link
  }
  return url;
}
