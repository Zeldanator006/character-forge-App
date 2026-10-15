'use strict';
/* Color themes: each preset sets four colors; everything else (borders, muted text, highlights)
   is mixed from those in style.css, so custom colors stay consistent too. */

const THEMES = {
  'graph-paper': { name: 'Graph paper', dark: false, paper: '#f4f6f8', panel: '#ffffff', ink: '#22262b', accent: '#2347a0' },
  'sea-chart': { name: 'Sea chart', dark: false, paper: '#ecf2f4', panel: '#fbfdfe', ink: '#1b2a30', accent: '#0d6b80' },
  sage: { name: 'Sage', dark: false, paper: '#edf1ec', panel: '#fbfcfa', ink: '#1f2a23', accent: '#2e6a4c' },
  feywild: { name: 'Feywild', dark: false, paper: '#f3f0f7', panel: '#fdfcff', ink: '#27212f', accent: '#6c3fa3' },
  midnight: { name: 'Midnight', dark: true, paper: '#10151c', panel: '#18202a', ink: '#e2e8f0', accent: '#82a8ff' },
  torchlight: { name: 'Torchlight', dark: true, paper: '#15130f', panel: '#201c17', ink: '#ede5d8', accent: '#f2a446' },
  infernal: { name: 'Infernal', dark: true, paper: '#150e0f', panel: '#211617', ink: '#f2e4e2', accent: '#f0625a' },
  'deep-forest': { name: 'Deep forest', dark: true, paper: '#0e1511', panel: '#16201a', ink: '#dfeae2', accent: '#5cc48a' },
  'high-contrast': { name: 'High contrast', dark: true, paper: '#000000', panel: '#000000', ink: '#ffffff', accent: '#ffd60a' },
};
const THEME_DEFAULT = { mode: 'light', light: 'graph-paper', dark: 'midnight',
  custom: { paper: '#eef1f4', panel: '#ffffff', ink: '#1f2329', accent: '#7a3fb0' } };

function hexRgb(hex) {
  const h = String(hex || '').replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
function luminance(hex) {
  const [r, g, b] = hexRgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function resolveTheme(cfg) {
  cfg = { ...THEME_DEFAULT, ...(cfg || {}) };
  let mode = cfg.mode;
  if (mode === 'system') mode = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const id = cfg[mode] || (mode === 'dark' ? 'midnight' : 'graph-paper');
  if (id === 'custom') {
    const c = { ...THEME_DEFAULT.custom, ...(cfg.custom || {}) };
    return { id, mode, name: 'Custom', ...c, dark: luminance(c.paper) < 0.2 };
  }
  return { id, mode, ...(THEMES[id] || THEMES[mode === 'dark' ? 'midnight' : 'graph-paper']) };
}

function themeCss(t) {
  const d = t.dark;
  const vars = {
    '--paper': t.paper, '--panel': t.panel, '--ink': t.ink, '--accent': t.accent,
    '--on-accent': contrast(t.accent, '#ffffff') >= contrast(t.accent, '#000000') ? '#ffffff' : '#000000',
    '--warn': d ? '#ff8f82' : '#b02a20', '--ok': d ? '#74d392' : '#2f6b3a',
    '--amber': d ? '#e8bb55' : '#7f5900', '--mark-base': d ? '#b89400' : '#ffe14d',
  };
  return `html:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')};color-scheme:${d ? 'dark' : 'light'}}`;
}

function applyTheme(cfg) {
  const t = resolveTheme(cfg);
  const css = themeCss(t);
  let el = document.getElementById('theme');
  if (!el) { el = document.createElement('style'); el.id = 'theme'; document.head.append(el); }
  el.textContent = css;
  document.documentElement.dataset.mode = t.dark ? 'dark' : 'light';
  try { localStorage.setItem('cb-theme-css', css); localStorage.setItem('cb-theme-mode', t.dark ? 'dark' : 'light'); } catch (e) { /* private window */ }
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.setAttribute('aria-label', t.dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.querySelector('span').textContent = t.dark ? 'Light' : 'Dark';
  }
  return t;
}

if (window.matchMedia) {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (window.S && S.theme && S.theme.mode === 'system') applyTheme(S.theme);
  });
}
