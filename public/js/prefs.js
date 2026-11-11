// Per-device preferences (accessibility, volume, camera), kept in localStorage.
const KEY = 'mgu.prefs';
const DEFAULTS = { music: 0.5, sfx: 0.8, sens: 1, invert: false, large: false, motion: false, lefty: false, quality: 'auto' };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const prefs = load();

export function savePrefs() {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch { /* storage may be blocked */ }
  applyBodyPrefs();
}

export function applyBodyPrefs() {
  document.body.classList.toggle('large-text', !!prefs.large);
  document.body.classList.toggle('reduced-motion', !!prefs.motion);
  document.body.classList.toggle('lefty', !!prefs.lefty);
}

export const store = {
  get(k, fallback = null) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch { /* ignore */ }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch { /* ignore */ }
  },
};
