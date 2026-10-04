// Theme lives in localStorage so it can be applied before IndexedDB opens
const THEME_KEY = 'palate_theme';

export function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'light';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#1a1a1a' : '#fafafa');
}

export function toggleTheme() {
  const next = getTheme() === 'light' ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  return next;
}
