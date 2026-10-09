import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the design system (see DESIGN.md): every text/background pair is AA in both themes,
 * and components cannot bring raw colours, font sizes or layers back.
 */
const root = process.cwd();
const tokensCss = readFileSync(resolve(root, 'src/client/styles/tokens.css'), 'utf8');
const stylesCss = readFileSync(resolve(root, 'src/client/styles.css'), 'utf8');

type Rgb = [number, number, number];
const decls = new Map<string, string>();
for (const m of tokensCss.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls.set(m[1], m[2].trim());

/** Resolves a token to a colour for one theme: follows var() and picks the right side of light-dark(). */
function resolveValue(name: string, theme: 'light' | 'dark'): string {
  let v = decls.get(name);
  if (v === undefined) throw new Error(`Нет токена ${name}`);
  for (let i = 0; i < 12; i++) {
    const ld = /^light-dark\(\s*(.+?)\s*,\s*(.+)\)$/.exec(v);
    if (ld) {
      // split on the top-level comma
      const inner = v.slice('light-dark('.length, -1);
      let depth = 0;
      let cut = -1;
      for (let k = 0; k < inner.length; k++) {
        if (inner[k] === '(') depth++;
        else if (inner[k] === ')') depth--;
        else if (inner[k] === ',' && depth === 0) {
          cut = k;
          break;
        }
      }
      v = (theme === 'light' ? inner.slice(0, cut) : inner.slice(cut + 1)).trim();
      continue;
    }
    const ref = /^var\((--[\w-]+)\)$/.exec(v);
    if (ref) {
      v = decls.get(ref[1]);
      if (v === undefined) throw new Error(`Нет токена ${ref[1]}`);
      continue;
    }
    return v;
  }
  throw new Error(`Не удалось разрешить ${name}`);
}

const parse = (css: string): { rgb: Rgb; a: number } => {
  const hex = /^#([0-9a-f]{6})$/i.exec(css);
  if (hex) return { rgb: [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb, a: 1 };
  const fn = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(css);
  if (fn) return { rgb: [Number(fn[1]), Number(fn[2]), Number(fn[3])], a: fn[4] === undefined ? 1 : Number(fn[4]) };
  throw new Error(`Не цвет: ${css}`);
};
const colour = (name: string, theme: 'light' | 'dark', over?: Rgb): Rgb => {
  const { rgb, a } = parse(resolveValue(name, theme));
  return a === 1 || !over ? rgb : (rgb.map((c, i) => Math.round(c * a + over[i] * (1 - a))) as Rgb);
};
const lum = ([r, g, b]: Rgb) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const SURFACES = ['--bg', '--surface', '--surface-2', '--surface-3'];
const STATUS = ['--success', '--danger', '--warn', '--info'];

const pairs: Array<{ fg: string; bg: string; min: number; why: string }> = [];
for (const fg of ['--text', '--text-2', '--text-3']) for (const bg of SURFACES) pairs.push({ fg, bg, min: 4.5, why: 'текст' });
for (const bg of [...SURFACES, '--accent-soft']) pairs.push({ fg: '--accent', bg, min: 4.5, why: 'акцент как текст' });
pairs.push({ fg: '--accent-ink', bg: '--accent', min: 4.5, why: 'текст на кнопке' }, { fg: '--accent-ink', bg: '--accent-2', min: 4.5, why: 'текст на кнопке при наведении' });
for (const k of STATUS) for (const bg of [...SURFACES, `${k}-soft`]) pairs.push({ fg: k, bg, min: 4.5, why: 'статус как текст' });
pairs.push({ fg: '--on-danger', bg: '--danger', min: 4.5, why: 'текст на красной кнопке' });
for (const bg of ['--bg', '--surface', '--surface-3']) pairs.push({ fg: '--border-control', bg, min: 3, why: 'граница поля (WCAG 1.4.11)' });
for (const bg of ['--bg', '--surface', '--surface-3']) pairs.push({ fg: '--accent', bg, min: 3, why: 'кольцо фокуса' });

describe('дизайн-система: контраст WCAG 2.2 AA', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`все пары токенов проходят в теме «${theme}»`, () => {
      const failures = pairs
        .map((p) => ({ ...p, r: ratio(colour(p.fg, theme), colour(p.bg, theme)) }))
        .filter((p) => p.r < p.min)
        .map((p) => `${p.fg} на ${p.bg}: ${p.r.toFixed(2)} < ${p.min} (${p.why})`);
      expect(failures).toEqual([]);
    });
  }

  it('полноэкранный режим и счёт-бумага читаются в обеих темах', () => {
    for (const theme of ['light', 'dark'] as const) {
      const bg = colour('--immersive-bg', theme);
      expect(ratio(colour('--immersive-text', theme), bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(colour('--immersive-text-2', theme, bg), bg)).toBeGreaterThanOrEqual(4.5);
      const paper = colour('--paper-bg', theme);
      for (const t of ['--paper-text', '--paper-text-2', '--paper-muted']) expect(ratio(colour(t, theme), paper)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('дизайн-система: компоненты используют только токены', () => {
  // Strip comments, then look at what is left.
  const css = stylesCss.replace(/\/\*[\s\S]*?\*\//g, '');

  it('в styles.css нет сырых цветов', () => {
    expect(css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? []).toEqual([]);
  });

  it('размеры шрифта только из шкалы (печатный счёт в pt — исключение)', () => {
    const bad = [...css.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => !v.startsWith('var(--fs-') && !/^[\d.]+pt$/.test(v) && !['inherit', 'inherit !important'].includes(v) && !/^\d+(\.\d+)?em$/.test(v) && v !== '100%');
    expect(bad).toEqual([]);
    expect(css.match(/font:\s*\d{3}\s+\d+px/g) ?? []).toEqual([]);
  });

  it('слои — только токены --z-*', () => {
    expect([...css.matchAll(/z-index:\s*(-?\d+)/g)].map((m) => m[1])).toEqual([]);
  });

  it('есть общие правила состояний: фокус с клавиатуры, отключено, уменьшенное движение', () => {
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/:disabled|\[aria-disabled/);
  });
});
