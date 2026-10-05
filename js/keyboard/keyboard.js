/**
 * Palate Keys: an in-app keyboard that replaces the iOS keyboard.
 *
 * Text fields marked [data-pk] get inputmode="none", so the system keyboard
 * never opens; focus, caret and selection stay native. This module owns the
 * bottom of the screen while such a field is focused and edits it with
 * execCommand('insertText'), which keeps the native undo stack intact.
 */

import { LAYOUTS, ACCENTS } from './layouts.js';
import * as lang from './language.js';
import * as haptics from './haptics.js';

const LONG_PRESS_MS = 380;
const REPEAT_DELAY_MS = 420;
const REPEAT_CHAR_MS = 80;
const REPEAT_WORD_MS = 190;
const REPEAT_WORD_AFTER = 12;
const SWIPE_UP_PX = 22;
const SWIPE_DOWN_PX = 22;
const TRACKPAD_START_PX = 10;
const TRACKPAD_CHAR_PX = 9;
const TRACKPAD_LINE_PX = 26;
const BACKSPACE_SWIPE_PX = 34;
const DOUBLE_SPACE_MS = 450;
const DOUBLE_SHIFT_MS = 320;
const TERMINATORS = '.,!?;:';

const s = {
  root: null,
  rowsEl: null,
  barEl: null,
  popupEl: null,
  mode: 'auto',
  enabled: false,
  visible: false,
  target: null,
  layer: 'letters',
  shift: 'off',            // off | once | lock
  shiftManual: false,      // user toggled shift since the last edit
  lastShiftTap: 0,
  keys: [],
  touches: new Map(),
  lastSpaceAt: 0,
  lastKey: '',
  autoSpace: false,        // a prediction just inserted a trailing space
  revert: null,            // { start, original, corrected, caret }
  pending: null,           // { word, corr } computed while typing
  slots: [],
  action: null,            // { label, onTap } shown at the right of the bar
  autocorrect: true,
  predSeq: 0,
  predFrame: 0,
  expectedCaret: -1,
  offset: { x: 0, y: 0 },  // learned touch-vs-layout correction (iOS)
  debug: false,
  debugEl: null,
  onLearn: () => {},
  onVisibility: () => {}
};

// ============================================
// Public API
// ============================================

export function init({ mode = 'auto', autocorrect = true, haptics: hap = true, onLearn, onVisibility } = {}) {
  s.autocorrect = autocorrect;
  s.onLearn = onLearn || s.onLearn;
  s.onVisibility = onVisibility || s.onVisibility;
  haptics.setEnabled(hap);
  build();
  setMode(mode);

  document.addEventListener('focusin', (e) => {
    pinScroll();
    requestAnimationFrame(pinScroll);
    setTimeout(pinScroll, 350);
    if (s.enabled && isPkField(e.target)) show(e.target);
  });
  // iOS scrolls the document when a field is focused, even with overflow
  // hidden. Fixed elements then render in one place while touches report
  // another (taps land rows above the key). Keep the page pinned at the top.
  window.addEventListener('scroll', pinScroll, { passive: true });
  window.visualViewport?.addEventListener('scroll', pinScroll);
  window.visualViewport?.addEventListener('resize', () => s.visible && requestAnimationFrame(measure));
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!isPkField(document.activeElement)) hide();
    }, 0);
  });
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('input', (e) => {
    if (e.target === s.target) schedulePredictions();
  });
  window.addEventListener('resize', () => s.visible && requestAnimationFrame(measure));
}

function pinScroll() {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  const se = document.scrollingElement;
  if (se && se.scrollTop) se.scrollTop = 0;
  if (document.body.scrollTop) document.body.scrollTop = 0;
}

export function setDebug(on) {
  s.debug = on;
  if (!on && s.debugEl) {
    s.debugEl.remove();
    s.debugEl = null;
  }
}

export function setMode(mode) {
  s.mode = mode;
  s.enabled = mode === 'always' || (mode === 'auto' && matchMedia('(pointer: coarse)').matches);
  decorate(document);
  if (!s.enabled) hide();
  else if (isPkField(document.activeElement)) show(document.activeElement);
}

export function setAutocorrect(on) {
  s.autocorrect = on;
  schedulePredictions();
}

export function setHaptics(on) {
  haptics.setEnabled(on);
}

export function isEnabled() {
  return s.enabled;
}

export function isVisible() {
  return s.visible;
}

/**
 * Prepare [data-pk] fields under root: suppress the system keyboard (and
 * its autocorrect) when Palate Keys is on, restore it when off.
 */
export function decorate(root = document) {
  root.querySelectorAll('[data-pk]').forEach((el) => {
    if (s.enabled) {
      el.setAttribute('inputmode', 'none');
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('autocapitalize', 'off');
      el.spellcheck = false;
    } else {
      el.removeAttribute('inputmode');
      el.setAttribute('autocorrect', 'on');
      el.setAttribute('autocapitalize', el.dataset.pkCap === 'off' ? 'off' : 'sentences');
      el.spellcheck = true;
    }
  });
}

/**
 * Optional action button at the right end of the prediction bar
 */
export function setAction(action) {
  s.action = action;
  renderBar();
}

export function refresh() {
  schedulePredictions();
}

// ============================================
// DOM
// ============================================

function isPkField(el) {
  return Boolean(el && el.matches && el.matches('[data-pk]'));
}

function build() {
  s.root = document.createElement('div');
  s.root.className = 'pk';
  s.root.setAttribute('aria-hidden', 'true');
  s.root.innerHTML = `
    <div class="pk-bar">
      <button class="pk-bar-btn pk-hide" data-bar="hide" aria-label="Hide keyboard">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="pk-preds"></div>
      <button class="pk-bar-btn pk-action" data-bar="action"></button>
    </div>
    <div class="pk-rows"></div>
    <div class="pk-popup"></div>
  `;
  s.rowsEl = s.root.querySelector('.pk-rows');
  s.barEl = s.root.querySelector('.pk-bar');
  s.popupEl = s.root.querySelector('.pk-popup');
  document.body.appendChild(s.root);

  // Keep focus in the text field: nothing on the keyboard may take it
  const keep = (e) => e.preventDefault();
  s.root.addEventListener('mousedown', keep);
  s.root.addEventListener('touchstart', keep, { passive: false });

  s.rowsEl.addEventListener('pointerdown', onDown);
  s.rowsEl.addEventListener('pointermove', onMove);
  s.rowsEl.addEventListener('pointerup', onUp);
  s.rowsEl.addEventListener('pointercancel', onCancel);
  // touchstart is cancelled (to keep focus), so clicks never fire: use pointers
  let barDown = null;
  s.barEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    barDown = e.target.closest('button');
    barDown?.classList.add('pk-bar-down');
  });
  s.barEl.addEventListener('pointerup', (e) => {
    const btn = barDown;
    barDown = null;
    btn?.classList.remove('pk-bar-down');
    if (btn && btn === document.elementFromPoint(e.clientX, e.clientY)?.closest('button')) onBarPress(btn);
  });
  s.barEl.addEventListener('pointercancel', () => {
    barDown?.classList.remove('pk-bar-down');
    barDown = null;
  });
  // Mouse / keyboard activation on desktop
  s.barEl.addEventListener('click', (e) => {
    if (e.detail === 0 || e.pointerType === 'mouse') {
      const btn = e.target.closest('button');
      if (btn) onBarPress(btn);
    }
  });
  s.root.addEventListener('transitionend', () => s.visible && measure());

  renderKeys();
}

function show(target) {
  s.target = target;
  if (!s.visible) {
    s.visible = true;
    s.root.classList.add('pk-visible');
    document.documentElement.classList.add('pk-open');
  }
  renderKeys();
  requestAnimationFrame(() => {
    measure();
    updateAutoShift();
    schedulePredictions();
  });
}

function hide() {
  if (!s.visible) return;
  s.visible = false;
  s.target = null;
  s.root.classList.remove('pk-visible', 'pk-trackpad');
  document.documentElement.classList.remove('pk-open');
  document.documentElement.style.setProperty('--kb-h', '0px');
  s.touches.forEach((t) => clearTimers(t));
  s.touches.clear();
  s.onVisibility(false);
}

function measure() {
  if (!s.visible) return;
  document.documentElement.style.setProperty('--kb-h', `${s.root.offsetHeight}px`);
  measureKeys();
  s.onVisibility(true);
  keepCaretVisible();
}

function measureKeys() {
  s.keys.forEach((k) => { k.rect = k.el.getBoundingClientRect(); });
}

function keyLabel(def) {
  if (def.action === 'shift') {
    const filled = s.shift !== 'off';
    return `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 4l8 8h-5v8H9v-8H4z" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>${s.shift === 'lock' ? '<path d="M8 22h8" stroke="currentColor" stroke-width="1.6"/>' : ''}</svg>`;
  }
  if (def.action === 'backspace') {
    return '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M21 6H9l-6 6 6 6h12z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9.5l5 5M17 9.5l-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  }
  if (def.action === 'space') return 'space';
  if (def.action === 'enter') {
    const hint = s.target?.enterKeyHint;
    return hint && hint !== 'enter' ? hint : (s.target?.tagName === 'INPUT' ? 'done' : 'return');
  }
  if (def.action) return def.label;
  return displayChar(def.k);
}

function displayChar(ch) {
  return s.layer === 'letters' && s.shift !== 'off' ? ch.toUpperCase() : ch;
}

function normaliseDef(def) {
  return typeof def === 'string' ? { k: def } : def;
}

function renderKeys() {
  const rows = LAYOUTS[s.layer];
  s.keys = [];
  s.rowsEl.innerHTML = '';
  rows.forEach((row, r) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'pk-row';
    // Middle letter row is inset by half a key, like a physical keyboard
    if (s.layer === 'letters' && r === 1) rowEl.classList.add('pk-row-inset');
    row.map(normaliseDef).forEach((def) => {
      const el = document.createElement('div');
      el.className = 'pk-key' + (def.action ? ` pk-key-action pk-key-${def.action}` : '');
      el.style.flexGrow = def.w || 1;
      el.innerHTML = `<span class="pk-key-label">${keyLabel(def)}</span>` +
        (def.alt && s.layer === 'letters' ? `<span class="pk-key-alt">${def.alt}</span>` : '');
      rowEl.appendChild(el);
      s.keys.push({ el, def, rect: null, row: r });
    });
    s.rowsEl.appendChild(rowEl);
  });
  paintShift();
  if (s.visible) requestAnimationFrame(measure);
}

function refreshLabels() {
  s.keys.forEach((k) => {
    const label = k.el.querySelector('.pk-key-label');
    if (label) label.innerHTML = keyLabel(k.def);
  });
}

// ============================================
// Hit testing
// ============================================

function rectDistance(r, x, y) {
  const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
  const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
  return dx * dx + dy * dy;
}

function isLetterKey(key) {
  return key && !key.def.action && /^[a-z]$/.test(key.def.k);
}

function keyFromElement(el) {
  const keyEl = el?.closest?.('.pk-key');
  return keyEl ? s.keys.find((k) => k.el === keyEl) || null : null;
}

/**
 * The browser's own hit target is the key the user actually sees under
 * their finger. If the reported coordinates fall outside that key, the
 * coordinate space is shifted (iOS scroll quirk): learn the shift and apply
 * it to every geometric test (slides, gaps between keys, biasing).
 */
function calibrate(key, x, y) {
  const r = key.rect;
  if (!r) return false;
  const inside = x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1;
  // Coordinates agree with what's on screen: no correction needed.
  // Otherwise the true touch point is somewhere on this key; use its centre.
  s.offset = inside ? { x: 0, y: 0 } : { x: x - (r.left + r.width / 2), y: y - (r.top + r.height / 2) };
  return !inside;
}

function point(e) {
  return { x: e.clientX - s.offset.x, y: e.clientY - s.offset.y };
}

/**
 * Nearest key (no dead zones between keys). In the letter layer, touches
 * near a key edge are biased towards the letter most likely to come next.
 * `preferred` is the key the browser reports under the finger, if any.
 */
function hitTest(x, y, preferred = null) {
  let best = preferred;
  let bestD = Infinity;
  if (!best) {
    for (const key of s.keys) {
      if (!key.rect) continue;
      const d = rectDistance(key.rect, x, y);
      if (d < bestD) {
        bestD = d;
        best = key;
      }
    }
  }
  if (!isLetterKey(best) || s.layer !== 'letters') return best;

  const r = best.rect;
  const w = r.width;
  const h = r.height;
  const nx = (x - (r.left + w / 2)) / w;
  const ny = (y - (r.top + h / 2)) / h;
  if (Math.abs(nx) < 0.28 && Math.abs(ny) < 0.28) return best; // clearly inside

  const prefix = currentWordBefore();
  if (prefix === null) return best;
  const probs = lang.nextLetterProbs(prefix.toLowerCase());
  if (!probs.size) return best;

  let choice = best;
  let bestCost = Infinity;
  for (const key of s.keys) {
    if (!isLetterKey(key) || !key.rect) continue;
    const kr = key.rect;
    const dx = (x - (kr.left + kr.width / 2)) / kr.width;
    const dy = (y - (kr.top + kr.height / 2)) / kr.height;
    const dist = dx * dx + dy * dy;
    if (dist > 1.1) continue;
    const cost = dist - 0.09 * Math.log((probs.get(key.def.k) || 0) + 0.01);
    if (cost < bestCost) {
      bestCost = cost;
      choice = key;
    }
  }
  return choice;
}

// ============================================
// Pointer handling
// ============================================

function onDown(e) {
  if (!s.target) return;
  e.preventDefault();

  // Rollover typing: a new touch commits any letter still held down
  for (const t of [...s.touches.values()]) {
    if (t.mode === 'tap' && !t.key.def.action) {
      commit(t);
      s.touches.delete(t.id);
    }
  }

  // Key rects are cheap to read and may have moved (slide-in, rotation)
  if (!s.touches.size) measureKeys();
  pinScroll();
  const native = keyFromElement(e.target);
  const shifted = native ? calibrate(native, e.clientX, e.clientY) : false;
  const p = point(e);
  // When coordinates were shifted, the browser's target is the only truth
  const key = shifted ? native : hitTest(p.x, p.y, native);
  if (s.debug) showDebug(e, p, key);
  if (!key) return;
  try { s.rowsEl.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }

  const t = {
    id: e.pointerId,
    key,
    x0: p.x,
    y0: p.y,
    ax: p.x,
    ay: p.y,
    mode: 'tap',
    timer: 0,
    repeat: 0,
    swipes: 0,
    accent: 0
  };
  s.touches.set(e.pointerId, t);
  haptics.tick();
  press(key, true);

  const a = key.def.action;
  if (!a) {
    showPopup(key, displayChar(key.def.k));
    t.timer = setTimeout(() => startAccents(t), LONG_PRESS_MS);
  } else if (a === 'space') {
    t.timer = setTimeout(() => startTrackpad(t), LONG_PRESS_MS);
  } else if (a === 'backspace') {
    const el = s.target;
    const plain = el.selectionStart === el.selectionEnd && !isRevertable();
    t.deleted = plain ? el.value.slice(Math.max(0, el.selectionStart - 1), el.selectionStart) : '';
    backspace();
    t.timer = setTimeout(() => startRepeat(t), REPEAT_DELAY_MS);
  }
}

function onMove(e) {
  const t = s.touches.get(e.pointerId);
  if (!t) return;
  const { x, y } = point(e);
  const dx = x - t.x0;
  const dy = y - t.y0;
  const a = t.key.def.action;

  if (a === 'space') {
    if (t.mode === 'tap' && Math.abs(dx) > TRACKPAD_START_PX) startTrackpad(t);
    if (t.mode === 'trackpad') moveTrackpad(t, x, y);
    return;
  }

  if (a === 'backspace') {
    if (dx < -BACKSPACE_SWIPE_PX * (t.swipes + 1)) {
      clearTimers(t);
      if (t.mode === 'tap' && t.deleted) {
        // This is a swipe, not a tap: put back the character deleted on touch-down
        insert(t.deleted);
        t.deleted = '';
      }
      t.mode = 'swipe';
      t.swipes++;
      deleteWord();
      haptics.tick();
    }
    return;
  }

  if (a) return;

  if (t.mode === 'accent') {
    const opts = s.popupEl.querySelectorAll('.pk-accent');
    if (opts.length) {
      const first = opts[0].getBoundingClientRect();
      const width = first.width;
      const idx = Math.max(0, Math.min(opts.length - 1, Math.floor((x - first.left) / width)));
      if (idx !== t.accent) {
        t.accent = idx;
        opts.forEach((o, i) => o.classList.toggle('pk-accent-on', i === idx));
      }
    }
    return;
  }

  // Swipe down on a letter: change the case of the current word
  if (isLetterKey(t.key) && dy > SWIPE_DOWN_PX && dy > Math.abs(dx)) {
    if (t.mode !== 'case') {
      t.mode = 'case';
      clearTimers(t);
      haptics.tick();
      showPopup(t.key, casePreview(), true, true);
    }
    return;
  }

  if (t.mode === 'case' && dy < SWIPE_DOWN_PX / 2) {
    t.mode = 'tap';
    showPopup(t.key, displayChar(t.key.def.k));
  }

  if (t.key.def.alt && dy < -SWIPE_UP_PX && Math.abs(dy) > Math.abs(dx)) {
    if (t.mode !== 'alt') {
      t.mode = 'alt';
      clearTimers(t);
      showPopup(t.key, t.key.def.alt, true);
    }
    return;
  }

  if (t.mode === 'alt' && dy > -SWIPE_UP_PX / 2) {
    t.mode = 'tap';
    showPopup(t.key, displayChar(t.key.def.k));
  }

  // Slide correction: the key under the finger at release is the one typed
  if (t.mode === 'tap') {
    const key = hitTest(x, y);
    if (key && key !== t.key && !key.def.action) {
      press(t.key, false);
      t.key = key;
      press(key, true);
      showPopup(key, displayChar(key.def.k));
      clearTimers(t);
      t.timer = setTimeout(() => startAccents(t), LONG_PRESS_MS);
    }
  }
}

function onUp(e) {
  const t = s.touches.get(e.pointerId);
  if (!t) return;
  s.touches.delete(e.pointerId);
  commit(t);
}

function onCancel(e) {
  const t = s.touches.get(e.pointerId);
  if (!t) return;
  s.touches.delete(e.pointerId);
  clearTimers(t);
  press(t.key, false);
  hidePopup();
  endTrackpad();
}

function showDebug(e, p, key) {
  if (!s.debugEl) {
    s.debugEl = document.createElement('div');
    s.debugEl.className = 'pk-debug';
    s.debugEl.innerHTML = '<div class="pk-debug-raw"></div><div class="pk-debug-fixed"></div><div class="pk-debug-info"></div>';
    document.body.appendChild(s.debugEl);
  }
  const [raw, fixed, info] = s.debugEl.children;
  raw.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  fixed.style.transform = `translate(${p.x}px, ${p.y}px)`;
  const vv = window.visualViewport;
  info.textContent = `key ${key ? (key.def.k || key.def.action) : '–'} · target ${keyFromElement(e.target) ? 'key' : e.target.className || e.target.tagName}` +
    ` · offset ${Math.round(s.offset.x)},${Math.round(s.offset.y)} · scrollY ${Math.round(window.scrollY)}` +
    ` · vv ${vv ? `${Math.round(vv.offsetTop)}/${Math.round(vv.height)}@${vv.scale.toFixed(2)}` : 'n/a'} · inner ${window.innerHeight}`;
}

function clearTimers(t) {
  clearTimeout(t.timer);
  clearInterval(t.repeat);
  t.timer = 0;
  t.repeat = 0;
}

function commit(t) {
  clearTimers(t);
  press(t.key, false);
  hidePopup();
  const def = t.key.def;

  if (!def.action) {
    if (t.mode === 'case') cycleWordCase();
    else if (t.mode === 'alt') typeChar(def.alt);
    else if (t.mode === 'accent') {
      const opts = accentOptions(def.k);
      typeChar(opts[t.accent] || def.k);
    } else typeChar(displayChar(def.k));
    return;
  }

  switch (def.action) {
    case 'space':
      if (t.mode === 'trackpad') endTrackpad();
      else typeSpace();
      break;
    case 'shift':
      toggleShift();
      break;
    case 'layer':
      setLayer(def.to);
      break;
    case 'enter':
      typeEnter();
      break;
    case 'undo':
      document.execCommand('undo');
      break;
    case 'redo':
      document.execCommand('redo');
      break;
    default:
      break;
  }
}

function press(key, on) {
  key.el.classList.toggle('pk-key-down', on);
}

function showPopup(key, text, alt = false, wide = false) {
  if (key.def.action || !key.rect) return;
  const r = key.rect;
  const rootRect = s.root.getBoundingClientRect();
  s.popupEl.className = 'pk-popup pk-popup-on' + (alt ? ' pk-popup-alt' : '') + (wide ? ' pk-popup-wide' : '');
  s.popupEl.textContent = text;
  s.popupEl.style.width = wide ? 'auto' : `${Math.max(r.width + 16, 44)}px`;
  s.popupEl.style.left = `${r.left - rootRect.left + r.width / 2}px`;
  s.popupEl.style.top = `${r.top - rootRect.top}px`;
}

function hidePopup() {
  s.popupEl.className = 'pk-popup';
}

function accentOptions(ch) {
  const base = ACCENTS[ch] || [];
  const upper = s.layer === 'letters' && s.shift !== 'off';
  return [displayChar(ch), ...base.map((a) => (upper ? a.toUpperCase() : a))];
}

function startAccents(t) {
  const opts = accentOptions(t.key.def.k);
  if (opts.length < 2) return;
  t.mode = 'accent';
  t.accent = 0;
  haptics.tick();
  const r = t.key.rect;
  const rootRect = s.root.getBoundingClientRect();
  s.popupEl.className = 'pk-popup pk-popup-on pk-popup-accents';
  s.popupEl.innerHTML = opts.map((o, i) => `<span class="pk-accent${i === 0 ? ' pk-accent-on' : ''}">${o}</span>`).join('');
  const width = opts.length * 38;
  let left = r.left - rootRect.left + r.width / 2 - 19;
  left = Math.min(left, rootRect.width - width - 4);
  s.popupEl.style.width = `${width}px`;
  s.popupEl.style.left = `${Math.max(4, left) + width / 2}px`;
  s.popupEl.style.top = `${r.top - rootRect.top}px`;
}

// ============================================
// Trackpad (space bar)
// ============================================

function startTrackpad(t) {
  if (t.mode === 'trackpad') return;
  clearTimers(t);
  t.mode = 'trackpad';
  t.ax = t.x0;
  t.ay = t.y0;
  haptics.tick();
  s.root.classList.add('pk-trackpad');
  const el = s.target;
  if (el) el.setSelectionRange(el.selectionEnd, el.selectionEnd);
}

function moveTrackpad(t, x, y) {
  const el = s.target;
  if (!el) return;
  const chars = Math.trunc((x - t.ax) / TRACKPAD_CHAR_PX);
  if (chars) {
    t.ax += chars * TRACKPAD_CHAR_PX;
    const pos = Math.max(0, Math.min(el.value.length, el.selectionStart + chars));
    setCaret(pos);
  }
  const lines = Math.trunc((y - t.ay) / TRACKPAD_LINE_PX);
  if (lines && el.tagName === 'TEXTAREA') {
    t.ay += lines * TRACKPAD_LINE_PX;
    setCaret(caretAfterLineMove(el.value, el.selectionStart, lines));
  }
}

function endTrackpad() {
  s.root.classList.remove('pk-trackpad');
  s.autoSpace = false;
  s.revert = null;
  schedulePredictions();
}

function caretAfterLineMove(text, pos, lines) {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const col = pos - lineStart;
  let start = lineStart;
  if (lines < 0) {
    for (let i = 0; i < -lines && start > 0; i++) start = text.lastIndexOf('\n', start - 2) + 1;
  } else {
    for (let i = 0; i < lines; i++) {
      const next = text.indexOf('\n', start);
      if (next === -1) return text.length;
      start = next + 1;
    }
  }
  const end = text.indexOf('\n', start);
  const lineLen = (end === -1 ? text.length : end) - start;
  return start + Math.min(col, lineLen);
}

function setCaret(pos) {
  s.expectedCaret = pos;
  s.target.setSelectionRange(pos, pos);
  keepCaretVisible();
}

// ============================================
// Editing primitives
// ============================================

function insert(text) {
  const el = s.target;
  if (!el) return;
  if (!document.execCommand('insertText', false, text)) {
    const start = el.selectionStart;
    el.setRangeText(text, start, el.selectionEnd, 'end');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
  s.expectedCaret = el.selectionStart;
  keepCaretVisible();
}

function replaceRange(start, end, text) {
  const el = s.target;
  el.setSelectionRange(start, end);
  if (text) insert(text);
  else deleteSelection();
}

function deleteSelection() {
  const el = s.target;
  if (!document.execCommand('delete')) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) {
      if (start === 0) return;
      el.setRangeText('', start - 1, start, 'end');
    } else {
      el.setRangeText('', start, end, 'end');
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  }
  s.expectedCaret = el.selectionStart;
}

function keepCaretVisible() {
  const el = s.target;
  if (!el || el.tagName !== 'TEXTAREA') return;
  // Approximate caret line from the text before it and scroll it into view
  const before = el.value.slice(0, el.selectionStart);
  const mirror = getMirror(el);
  mirror.textContent = before + '​';
  const caretY = mirror.scrollHeight;
  const lineH = parseFloat(getComputedStyle(el).lineHeight) || 24;
  if (caretY > el.scrollTop + el.clientHeight - 8) {
    el.scrollTop = caretY - el.clientHeight + lineH;
  } else if (caretY - lineH < el.scrollTop) {
    el.scrollTop = Math.max(0, caretY - lineH * 1.5);
  }
}

let mirrorEl = null;
function getMirror(el) {
  if (!mirrorEl) {
    mirrorEl = document.createElement('div');
    mirrorEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(mirrorEl);
  }
  const cs = getComputedStyle(el);
  mirrorEl.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;height:auto;
    width:${el.clientWidth}px;font:${cs.font};line-height:${cs.lineHeight};letter-spacing:${cs.letterSpacing};
    padding:${cs.paddingTop} ${cs.paddingRight} 0 ${cs.paddingLeft};box-sizing:border-box;`;
  return mirrorEl;
}

function textBeforeCaret() {
  const el = s.target;
  return el ? el.value.slice(0, el.selectionStart) : '';
}

function currentWordBefore() {
  const el = s.target;
  if (!el || el.selectionStart !== el.selectionEnd) return null;
  const m = textBeforeCaret().match(/[A-Za-z']+$/);
  return m ? m[0] : '';
}

function isSentenceStart(before) {
  if (s.target?.dataset.pkCap === 'off') return false;
  return before.trim() === '' || /[.!?]\s+$/.test(before) || /\n\s*$/.test(before);
}

// ============================================
// Typing behaviour
// ============================================

function afterEdit() {
  const prev = s.shift;
  s.shiftManual = false;
  if (s.shift === 'once') s.shift = 'off';
  updateAutoShift();
  if (s.shift !== prev) paintShift();
  schedulePredictions();
}

function typeChar(ch) {
  if (!s.target) return;
  s.revert = null;

  if (TERMINATORS.includes(ch)) {
    const before = textBeforeCaret();
    if (s.autoSpace && before.endsWith(' ')) {
      // "word |" + "." -> "word. |"
      deleteSelection();
      insert(ch + (ch === ',' || ch === ';' || ch === ':' || '.!?'.includes(ch) ? ' ' : ''));
      s.autoSpace = true;
      s.lastKey = ch;
      afterEdit();
      return;
    }
    applyAutocorrect(ch);
    insert(ch);
    if (s.revert) s.revert.caret = s.target.selectionStart;
  } else {
    insert(ch);
  }

  s.autoSpace = false;
  s.lastKey = ch;
  if (ch === '\'' && s.layer !== 'letters') setLayer('letters');
  afterEdit();
}

function typeSpace() {
  if (!s.target) return;
  const now = Date.now();
  const before = textBeforeCaret();

  // Double-tap space -> ". "
  if (s.lastKey === 'space' && now - s.lastSpaceAt < DOUBLE_SPACE_MS &&
      /[A-Za-z0-9)"'’]\s$/.test(before) && s.target.dataset.pkCap !== 'off') {
    replaceRange(before.length - 1, before.length, '. ');
    s.lastKey = '.';
    s.lastSpaceAt = 0;
    s.autoSpace = false;
    s.revert = null;
    afterEdit();
    return;
  }

  s.lastKey = 'space';
  s.lastSpaceAt = now;

  if (s.autoSpace) {
    // A prediction already added the space; this tap only arms double-space
    s.autoSpace = false;
    return;
  }

  applyAutocorrect(' ');
  insert(' ');
  if (s.revert) s.revert.caret = s.target.selectionStart;
  if (s.layer !== 'letters') setLayer('letters');
  afterEdit();
}

function typeEnter() {
  const el = s.target;
  if (!el) return;
  s.autoSpace = false;
  if (el.tagName === 'INPUT') {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    el.dispatchEvent(new CustomEvent('pk-enter', { bubbles: true }));
    return;
  }
  applyAutocorrect('\n');
  insert('\n');
  s.revert = null;
  s.lastKey = 'enter';
  afterEdit();
}

function isRevertable() {
  const el = s.target;
  const r = s.revert;
  return Boolean(r && el && el.selectionStart === el.selectionEnd && el.selectionStart === r.caret &&
    el.value.slice(r.start, r.start + r.corrected.length) === r.corrected);
}

function backspace() {
  const el = s.target;
  if (!el) return;
  const r = s.revert;
  if (isRevertable()) {
    // Undo the autocorrection and remember the word
    replaceRange(r.start, r.caret, r.original);
    s.onLearn(r.original);
    s.revert = null;
    s.autoSpace = false;
    afterEdit();
    return;
  }
  s.revert = null;
  s.autoSpace = false;
  if (el.selectionStart === 0 && el.selectionEnd === 0) return;
  deleteSelection();
  s.lastKey = 'backspace';
  afterEdit();
}

function deleteWord() {
  const el = s.target;
  if (!el) return;
  s.revert = null;
  s.autoSpace = false;
  if (el.selectionStart !== el.selectionEnd) {
    deleteSelection();
  } else {
    const v = el.value;
    const end = el.selectionStart;
    let i = end;
    while (i > 0 && /\s/.test(v[i - 1])) i--;
    if (i > 0 && /[^\w\s]/.test(v[i - 1])) i--;
    else while (i > 0 && /[\w'’]/.test(v[i - 1])) i--;
    if (i === end) return;
    replaceRange(i, end, '');
  }
  afterEdit();
}

function startRepeat(t) {
  let count = 0;
  t.mode = 'repeat';
  const tickChar = () => {
    count++;
    backspace();
    if (count >= REPEAT_WORD_AFTER) {
      clearInterval(t.repeat);
      t.repeat = setInterval(deleteWord, REPEAT_WORD_MS);
    }
  };
  t.repeat = setInterval(tickChar, REPEAT_CHAR_MS);
}

function toggleShift() {
  const now = Date.now();
  if (now - s.lastShiftTap < DOUBLE_SHIFT_MS) {
    s.shift = 'lock';
    setTimeout(() => haptics.tick(), 70); // second tick confirms caps lock
  } else {
    s.shift = s.shift === 'off' ? 'once' : 'off';
  }
  s.lastShiftTap = now;
  s.shiftManual = true;
  paintShift();
}

/**
 * Reflect shift state on the keys: uppercase labels, a filled arrow for
 * one-shot shift, and a lit indicator + highlighted key for caps lock
 */
function paintShift() {
  s.rowsEl.classList.toggle('pk-shifted', s.shift !== 'off');
  s.rowsEl.classList.toggle('pk-capslock', s.shift === 'lock');
  for (const k of s.keys) {
    if (k.def.action !== 'shift') continue;
    k.el.classList.toggle('pk-shift-once', s.shift === 'once');
    k.el.classList.toggle('pk-shift-lock', s.shift === 'lock');
  }
  refreshLabels();
}

// ============================================
// Word case (swipe down on a letter)
// ============================================

function nextCase(word) {
  const lower = word.toLowerCase();
  const upper = word.toUpperCase();
  if (word === lower) return lower[0].toUpperCase() + lower.slice(1); // john -> John
  if (word !== upper && word.length > 1) return upper;                // John -> JOHN
  return lower;                                                        // JOHN -> john
}

/**
 * The word the caret is in or just after (one trailing space allowed, so a
 * word can be fixed right after finishing it). Returns null if none.
 */
function wordAtCaret() {
  const el = s.target;
  if (!el) return null;
  const v = el.value;
  if (el.selectionStart !== el.selectionEnd) {
    return { start: el.selectionStart, end: el.selectionEnd, text: v.slice(el.selectionStart, el.selectionEnd) };
  }
  const isWordChar = (ch) => /[A-Za-z'’]/.test(ch || '');
  let pos = el.selectionStart;
  // "john |" -> still means john, so a word can be fixed right after the space
  if (!isWordChar(v[pos]) && v[pos - 1] === ' ' && isWordChar(v[pos - 2])) pos--;
  let start = pos;
  while (start > 0 && isWordChar(v[start - 1])) start--;
  let end = pos;
  while (end < v.length && isWordChar(v[end])) end++;
  const text = v.slice(start, end);
  return /[A-Za-z]/.test(text) ? { start, end, text } : null;
}

function casePreview() {
  const w = wordAtCaret();
  if (!w) return '⇧ Aa';
  const next = w.text.replace(/[A-Za-z][A-Za-z'’]*/g, (m) => nextCase(m));
  return next.length > 14 ? next.slice(0, 13) + '…' : next;
}

function cycleWordCase() {
  const el = s.target;
  if (!el) return;
  const w = wordAtCaret();
  if (!w) {
    // Nothing to change yet: capitalize the next letter instead
    s.shift = 'once';
    s.shiftManual = true;
    paintShift();
    return;
  }
  const hadSelection = el.selectionStart !== el.selectionEnd;
  const caret = el.selectionEnd;
  const next = w.text.replace(/[A-Za-z][A-Za-z'’]*/g, (m) => nextCase(m));
  if (next === w.text) return;
  replaceRange(w.start, w.end, next);
  if (hadSelection) el.setSelectionRange(w.start, w.start + next.length);
  else setCaret(caret);
  s.expectedCaret = el.selectionStart;
  s.revert = null;
  s.autoSpace = false;
  schedulePredictions();
}

function setLayer(layer) {
  s.layer = layer;
  renderKeys();
}

function updateAutoShift() {
  if (!s.target || s.shift === 'lock' || s.shiftManual) return;
  const next = isSentenceStart(textBeforeCaret()) ? 'once' : 'off';
  if (next !== s.shift) {
    s.shift = next;
    paintShift();
  }
}

function applyAutocorrect(terminator) {
  if (!s.autocorrect || !s.target || s.target.dataset.pkCorrect === 'off') return;
  const el = s.target;
  if (el.selectionStart !== el.selectionEnd) return;
  const word = currentWordBefore();
  if (!word || word.replace(/'/g, '').length < 1) return;
  const start = el.selectionStart - word.length;
  // Don't touch words glued to digits, URLs, #tags or @handles
  const prevChar = el.value[start - 1];
  if (prevChar && /[\w#@/.:]/.test(prevChar) && prevChar !== ' ') {
    if (!(prevChar === '.' && /\s/.test(el.value[start - 2] || ' '))) return;
  }
  if (terminator === '.' && /^(www|http|https)$/i.test(word)) return;

  const sentenceStart = isSentenceStart(el.value.slice(0, start));
  const corr = s.pending && s.pending.word === word
    ? s.pending.corr
    : lang.correct(word, { sentenceStart });
  if (corr && corr !== word) {
    replaceRange(start, start + word.length, corr);
    s.revert = { start, original: word, corrected: corr, caret: -1 };
  }
}

function onSelectionChange() {
  const el = s.target;
  if (!el || document.activeElement !== el) return;
  if (el.selectionStart !== s.expectedCaret) {
    // The user moved the caret: drop context-sensitive state
    s.autoSpace = false;
    s.revert = null;
    s.expectedCaret = el.selectionStart;
    if (!s.shiftManual) updateAutoShift();
    schedulePredictions();
  }
}

// ============================================
// Prediction bar
// ============================================

function schedulePredictions() {
  if (!s.visible) return;
  cancelAnimationFrame(s.predFrame);
  s.predFrame = requestAnimationFrame(computePredictions);
}

function contextWords(text) {
  return text
    .replace(/[‘’]/g, '\'')
    .split(/[^A-Za-z']+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w.toLowerCase());
}

async function computePredictions() {
  const el = s.target;
  if (!el) return;
  const seq = ++s.predSeq;
  const before = textBeforeCaret();
  const partial = currentWordBefore() || '';
  const head = before.slice(0, before.length - partial.length);
  const context = /[.!?\n]\s*$/.test(head) ? [] : contextWords(head);
  const sentenceStart = isSentenceStart(head);
  let slots = [];

  try {
    if (partial) {
      const [comps, counts] = await Promise.all([
        lang.complete(partial, context, 4),
        lang.contextCountsFor(context)
      ]);
      const corr = s.autocorrect && el.dataset.pkCorrect !== 'off'
        ? lang.correct(partial, { sentenceStart, contextCounts: counts })
        : null;
      if (seq !== s.predSeq) return;
      s.pending = { word: partial, corr };

      const caseFor = (w) => (sentenceStart || partial[0] !== partial[0].toLowerCase() ? lang.matchCase(partial, w) : w);
      const rest = comps.map(caseFor).filter((w) => w !== corr && w.toLowerCase() !== partial.toLowerCase());
      if (corr) {
        slots = [
          { label: `“${partial}”`, value: partial, kind: 'literal' },
          { label: corr, value: corr, kind: 'word', primary: true },
          rest[0] && { label: rest[0], value: rest[0], kind: 'word' }
        ];
      } else {
        const exact = lang.isKnown(partial);
        slots = [
          { label: exact ? partial : `“${partial}”`, value: partial, kind: 'literal' },
          rest[0] && { label: rest[0], value: rest[0], kind: 'word', primary: true },
          rest[1] && { label: rest[1], value: rest[1], kind: 'word' }
        ];
      }
    } else {
      const words = await lang.nextWords(context, 3, sentenceStart);
      if (seq !== s.predSeq) return;
      s.pending = null;
      const cased = words.map((w) => (sentenceStart ? w[0].toUpperCase() + w.slice(1) : w));
      slots = [
        cased[1] && { label: cased[1], value: cased[1], kind: 'word' },
        cased[0] && { label: cased[0], value: cased[0], kind: 'word', primary: true },
        cased[2] && { label: cased[2], value: cased[2], kind: 'word' }
      ];
    }
  } catch (err) {
    console.error('[keys] prediction error', err);
  }

  s.slots = slots;
  renderBar();
}

function renderBar() {
  if (!s.barEl) return;
  const preds = s.barEl.querySelector('.pk-preds');
  preds.innerHTML = [0, 1, 2].map((i) => {
    const slot = s.slots[i];
    if (!slot) return '<button class="pk-pred pk-pred-empty" disabled></button>';
    return `<button class="pk-pred${slot.primary ? ' pk-pred-primary' : ''}" data-slot="${i}">${escapeHtml(slot.label)}</button>`;
  }).join('');
  const actionBtn = s.barEl.querySelector('.pk-action');
  actionBtn.textContent = s.action?.label || '';
  actionBtn.style.visibility = s.action ? 'visible' : 'hidden';
}

function onBarPress(btn) {
  if (btn.disabled) return;
  haptics.tick();
  if (btn.dataset.bar === 'hide') {
    s.target?.blur();
    return;
  }
  if (btn.dataset.bar === 'action') {
    s.action?.onTap?.();
    return;
  }
  const slot = s.slots[Number(btn.dataset.slot)];
  if (slot) acceptSlot(slot);
}

function acceptSlot(slot) {
  const el = s.target;
  if (!el) return;
  const partial = currentWordBefore() || '';
  const start = el.selectionStart - partial.length;
  const after = el.value[el.selectionStart];
  const needsSpace = !after || !/\s/.test(after);
  replaceRange(start, el.selectionStart, slot.value + (needsSpace ? ' ' : ''));
  if (!needsSpace) setCaret(el.selectionStart + 1);
  if (slot.kind === 'literal' && !lang.isKnown(slot.value)) s.onLearn(slot.value);
  s.revert = null;
  s.autoSpace = true;
  s.lastKey = 'prediction';
  afterEdit();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}
