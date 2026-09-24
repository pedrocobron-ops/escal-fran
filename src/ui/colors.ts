import type { Asb } from '../domain';

export const ASB_PALETTE = [
  '#C2410C', '#0F766E', '#1D4ED8', '#7E22CE', '#BE185D', '#4D7C0F', '#B45309', '#0E7490', '#6D28D9', '#9F1239', '#047857', '#1E40AF',
];

/** Cor da ficha: a cadastrada ou uma derivada da posição na lista. */
export function asbColor(asb: Asb, index: number): string {
  return asb.color ?? ASB_PALETTE[index % ASB_PALETTE.length];
}

export function colorMap(asbs: Asb[]): Map<string, string> {
  return new Map(asbs.map((a, i) => [a.id, asbColor(a, i)]));
}

/** Versão bem clara de uma cor hex, para fundo de célula. */
export function tint(hex: string, amount = 0.88): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const mix = (c: string) => Math.round(parseInt(c, 16) + (255 - parseInt(c, 16)) * amount);
  return `rgb(${mix(m[1])}, ${mix(m[2])}, ${mix(m[3])})`;
}
