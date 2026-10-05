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
import * as aim from './aim.js';
import * as clips from './clips.js';
import * as shortcuts from './shortcuts.js';

const LONG_PRESS_MS = 380;
const BAR_DRAG_PX = 8;          // finger travel before a bar touch becomes a scroll
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
  select: { on: false, anchor: 0, focus: 0 },
  pasteHintUntil: 0,       // show a Paste chip briefly after cut/copy
  barNote: '',             // transient message in the bar ("Copied")
  clipsOpen: false,
  lastTap: null,           // { x, y, key, at } for aim learning
  missTap: null,           // a tap that was immediately backspaced
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

export function aimStats() {
  return aim.stats();
}

export function resetAim() {
  aim.reset();
}

export function setShortcuts(list) {
  shortcuts.setShortcuts(list);
}

export function clearClips() {
  clips.clear();
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
      <button class="pk-bar-btn pk-select" data-bar="select" aria-label="Select text">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 4h6M9 20h6M12 4v16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5 8v8M19 8v8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="2 2.5"/></svg>
      </button>
      <div class="pk-preds"></div>
      <button class="pk-bar-btn pk-action" data-bar="action"></button>
      <div class="pk-clips" hidden></div>
      <div class="pk-sel-preview" hidden></div>
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
  let barLongTimer = 0;
  let barLongFired = false;
  // Native scrolling is off (touchstart is cancelled), so drag-scroll the
  // chip row sideways and the clipboard list up/down by hand
  let barDrag = null;
  s.barEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const scroller = e.target.closest('.pk-preds, .pk-clips');
    barDrag = scroller && {
      el: scroller,
      vertical: scroller.classList.contains('pk-clips'),
      x: e.clientX,
      y: e.clientY,
      left: scroller.scrollLeft,
      top: scroller.scrollTop,
      moved: false
    };
    if (barDrag) {
      try { s.barEl.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    }
    barDown = e.target.closest('button');
    barDown?.classList.add('pk-bar-down');
    barLongFired = false;
    clearTimeout(barLongTimer);
    if (barDown?.dataset.long) {
      const btn = barDown;
      barLongTimer = setTimeout(() => {
        barLongFired = true;
        haptics.tick();
        onBarLongPress(btn);
      }, LONG_PRESS_MS + 120);
    }
  });
  s.barEl.addEventListener('pointermove', (e) => {
    if (!barDrag) return;
    const dx = e.clientX - barDrag.x;
    const dy = e.clientY - barDrag.y;
    if (!barDrag.moved && Math.abs(barDrag.vertical ? dy : dx) < BAR_DRAG_PX) return;
    if (!barDrag.moved) {
      // It's a scroll, not a press
      barDrag.moved = true;
      clearTimeout(barLongTimer);
      barDown?.classList.remove('pk-bar-down');
    }
    if (barDrag.vertical) barDrag.el.scrollTop = barDrag.top - dy;
    else barDrag.el.scrollLeft = barDrag.left - dx;
    paintScrollHint();
  });
  s.barEl.addEventListener('pointerup', (e) => {
    clearTimeout(barLongTimer);
    const btn = barDown;
    const dragged = barDrag?.moved;
    barDown = null;
    barDrag = null;
    btn?.classList.remove('pk-bar-down');
    if (barLongFired || dragged) return;
    if (btn && btn === document.elementFromPoint(e.clientX, e.clientY)?.closest('button')) onBarPress(btn);
  });
  s.barEl.addEventListener('pointercancel', () => {
    barDrag = null;
    clearTimeout(barLongTimer);
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
  if (s.target !== target) {
    s.select.on = false;
    closeClips();
  }
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
  s.select.on = false;
  closeClips();
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

  const prefix = currentWordBefore();
  const probs = prefix === null ? null : lang.nextLetterProbs(prefix.toLowerCase());
  const useProbs = Boolean(probs && probs.size);
  if (!useProbs && !aim.ready()) return best;

  // Distances are measured to each key's learned centre (where this person
  // actually taps it), falling back to the drawn centre until learned
  const centre = (key) => {
    const o = aim.offset(key.def.k);
    const kr = key.rect;
    return { x: kr.left + kr.width * (0.5 + o.dx), y: kr.top + kr.height * (0.5 + o.dy), w: kr.width, h: kr.height };
  };
  const c = centre(best);
  if (Math.abs((x - c.x) / c.w) < 0.28 && Math.abs((y - c.y) / c.h) < 0.28) return best; // clearly inside

  let choice = best;
  let bestCost = Infinity;
  for (const key of s.keys) {
    if (!isLetterKey(key) || !key.rect) continue;
    const kc = centre(key);
    const dx = (x - kc.x) / kc.w;
    const dy = (y - kc.y) / kc.h;
    const dist = dx * dx + dy * dy;
    if (dist > 1.1) continue;
    const cost = dist - (useProbs ? 0.09 * Math.log((probs.get(key.def.k) || 0) + 0.01) : 0);
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
  if (s.clipsOpen) closeClips();

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
      t.slid = true;
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

  // Typing anything (other than moving/case/shift) ends select mode;
  // a selection is then replaced, like any text editor
  if (s.select.on && !['space', 'shift', 'layer'].includes(def.action) && t.mode !== 'case') {
    exitSelect(false);
  }

  if (!def.action) {
    if (t.mode === 'tap' && isLetterKey(t.key)) learnAim(t);
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
      else if (s.select.on) exitSelect(true);
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
  if (!el) return;
  if (s.select.on) syncSelectFromField();
  else el.setSelectionRange(el.selectionEnd, el.selectionEnd);
}

function moveTrackpad(t, x, y) {
  const el = s.target;
  if (!el) return;
  if (s.select.on) return moveSelection(t, x, y);
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
    if (!applyShortcut()) applyAutocorrect(ch);
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

  if (!applyShortcut()) applyAutocorrect(' ');
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
  if (!applyShortcut()) applyAutocorrect('\n');
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
    if (r.kind !== 'shortcut') s.onLearn(r.original);
    s.revert = null;
    s.autoSpace = false;
    afterEdit();
    return;
  }
  s.revert = null;
  s.autoSpace = false;
  if (el.selectionStart === 0 && el.selectionEnd === 0) return;
  // A letter deleted right after typing it may have been a miss: if the
  // next letter differs, that touch point taught us where they meant it
  const lt = s.lastTap;
  s.missTap = lt && Date.now() - lt.at < 2000 && el.selectionStart === el.selectionEnd ? lt : null;
  s.lastTap = null;
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
  if (s.shift === 'lock') {
    // Any tap releases caps lock (never re-locks, however fast)
    s.shift = 'off';
    s.lastShiftTap = 0;
  } else if (now - s.lastShiftTap < DOUBLE_SHIFT_MS) {
    s.shift = 'lock';
    s.lastShiftTap = 0;
    setTimeout(() => haptics.tick(), 70); // second tick confirms caps lock
  } else {
    s.shift = s.shift === 'off' ? 'once' : 'off';
    s.lastShiftTap = now;
  }
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

const WORD_RE = /[A-Za-z][A-Za-z'’]*/g;

/**
 * One step of lower -> Title -> UPPER -> lower, judged on the whole text so
 * a multi-word selection moves together (not each word on its own cycle)
 */
function nextCase(text) {
  const words = text.match(WORD_RE) || [];
  if (!words.length) return text;
  const allUpper = text === text.toUpperCase();
  const allTitle = words.every((w) => w[0] === w[0].toUpperCase());
  if (allUpper) return text.toLowerCase();                 // JOHN -> john
  if (allTitle) return text.toUpperCase();                 // John -> JOHN
  return text.replace(WORD_RE, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()); // john -> John
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
  const next = nextCase(w.text);
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
  const next = nextCase(w.text);
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
  if (s.select.on) {
    syncSelectFromField();
    renderBar();
  }
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

  // A typed shortcut trigger previews its expansion in the centre slot
  const token = (before.match(/\S+$/) || [''])[0];
  const expansion = token && shortcuts.expand(token);
  if (expansion) {
    s.pending = null;
    s.slots = [
      { label: `“${token}”`, value: token, kind: 'literal' },
      { label: `→ ${clips.preview(expansion, 24)}`, value: expansion, token, kind: 'shortcut', primary: true }
    ];
    renderBar();
    return;
  }

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

  // Right after a cut/copy, offer Paste: first slot, or the last one when a
  // half-typed word owns the first (e.g. the caret sits after the copied word)
  const clip = clips.latest();
  if (clip && Date.now() < s.pasteHintUntil) {
    slots[partial ? 2 : 0] = { label: `Paste “${clips.preview(clip.text, 14)}”`, value: clip.text, kind: 'paste' };
  }

  s.slots = slots;
  renderBar();
}

function renderBar() {
  if (!s.barEl) return;
  const preds = s.barEl.querySelector('.pk-preds');
  const actionBtn = s.barEl.querySelector('.pk-action');
  const selectBtn = s.barEl.querySelector('.pk-select');
  s.barEl.classList.toggle('pk-bar-selecting', s.select.on);
  selectBtn.classList.toggle('pk-on', s.select.on);
  selectBtn.setAttribute('aria-label', s.select.on ? 'Done selecting' : 'Select text');
  renderSelectionPreview();
  if (!s.select.on) paintScrollHint();

  if (s.barNote) {
    preds.innerHTML = `<span class="pk-bar-note">${escapeHtml(s.barNote)}</span>`;
  } else if (s.select.on) {
    const el = s.target;
    const has = el && el.selectionStart !== el.selectionEnd;
    const chip = (cmd, label, extra = '') => `<button class="pk-chip" data-cmd="${cmd}"${extra}>${label}</button>`;
    const paste = chip('paste', 'Paste', ' data-long="1"');
    preds.innerHTML = has
      ? chip('cut', 'Cut') + chip('copy', 'Copy') + paste + chip('case', 'Aa')
      : chip('word', 'Word') + chip('sentence', 'Sentence') + chip('paragraph', 'Para') + chip('all', 'All') + paste;
    actionBtn.textContent = has ? selectionLabel() : 'drag ␣';
    actionBtn.style.visibility = 'visible';
    actionBtn.disabled = true;
    actionBtn.classList.add('pk-action-info');
    preds.scrollLeft = 0;
    paintScrollHint();
    return;
  } else {
    preds.innerHTML = [0, 1, 2].map((i) => {
      const slot = s.slots[i];
      if (!slot) return '<button class="pk-pred pk-pred-empty" disabled></button>';
      const long = slot.kind === 'paste' ? ' data-long="1"' : '';
      return `<button class="pk-pred${slot.primary ? ' pk-pred-primary' : ''}${slot.kind === 'paste' ? ' pk-pred-paste' : ''}" data-slot="${i}"${long}>${escapeHtml(slot.label)}</button>`;
    }).join('');
  }
  actionBtn.disabled = false;
  actionBtn.classList.remove('pk-action-info');
  actionBtn.textContent = s.action?.label || '';
  actionBtn.style.visibility = s.action ? 'visible' : 'hidden';
}

// Fade the edge(s) of the chip row that have more chips beyond them
function paintScrollHint() {
  const preds = s.barEl.querySelector('.pk-preds');
  const more = s.select.on && preds.scrollWidth > preds.clientWidth + 1;
  preds.classList.toggle('pk-more-right', more && preds.scrollLeft + preds.clientWidth < preds.scrollWidth - 1);
  preds.classList.toggle('pk-more-left', more && preds.scrollLeft > 1);
}

function selectionLabel() {
  const el = s.target;
  const text = el.value.slice(el.selectionStart, el.selectionEnd);
  const words = (text.match(/\S+/g) || []).length;
  return words > 1 ? `${words} words` : `${text.length} char${text.length === 1 ? '' : 's'}`;
}

/**
 * Show what's selected in a strip above the bar: iOS doesn't reliably paint
 * the selection highlight while its own keyboard is hidden
 */
function renderSelectionPreview() {
  const strip = s.barEl.querySelector('.pk-sel-preview');
  const el = s.target;
  const text = el && s.select.on && !s.clipsOpen ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
  strip.hidden = !text.trim();
  if (!strip.hidden) strip.textContent = `“${clips.preview(text, 48)}”`;
}

function flashNote(text) {
  s.barNote = text;
  renderBar();
  setTimeout(() => {
    s.barNote = '';
    renderBar();
    schedulePredictions();
  }, 1100);
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
  if (btn.dataset.bar === 'select') {
    if (s.select.on) exitSelect(true);
    else enterSelect();
    return;
  }
  if (btn.dataset.clip !== undefined) {
    pasteFromHistory(btn.dataset.clip);
    return;
  }
  if (btn.dataset.cmd) {
    runCommand(btn.dataset.cmd);
    return;
  }
  const slot = s.slots[Number(btn.dataset.slot)];
  if (slot) acceptSlot(slot);
}

function onBarLongPress(btn) {
  // Hold Paste: pick from the clipboard history
  if (btn.dataset.cmd === 'paste' || btn.dataset.slot !== undefined) openClips();
}

function acceptSlot(slot) {
  const el = s.target;
  if (!el) return;
  if (slot.kind === 'paste') {
    pasteText(slot.value);
    return;
  }
  if (slot.kind === 'shortcut') {
    const start = el.selectionStart - slot.token.length;
    replaceRange(start, el.selectionStart, slot.value + ' ');
    s.revert = null;
    s.autoSpace = true;
    s.lastKey = 'prediction';
    afterEdit();
    return;
  }
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

// ============================================
// Text shortcuts
// ============================================

/**
 * Expand a shortcut trigger right before the caret (called as a space,
 * punctuation or return is typed). Backspace right after undoes it.
 */
function applyShortcut() {
  const el = s.target;
  if (!el || el.selectionStart !== el.selectionEnd) return false;
  const token = (textBeforeCaret().match(/\S+$/) || [''])[0];
  const expansion = token && shortcuts.expand(token);
  if (!expansion) return false;
  const start = el.selectionStart - token.length;
  replaceRange(start, el.selectionStart, expansion);
  s.revert = { start, original: token, corrected: expansion, caret: -1, kind: 'shortcut' };
  return true;
}

// ============================================
// Learned aim
// ============================================

function learnAim(t) {
  const r = t.key.rect;
  if (!r) return;
  const nx = (t.x0 - (r.left + r.width / 2)) / r.width;
  const ny = (t.y0 - (r.top + r.height / 2)) / r.height;
  const now = Date.now();
  // Backspaced and retyped as a different letter: the old touch was meant
  // for this key, which is the most useful sample there is
  const miss = s.missTap;
  if (miss && now - miss.at < 6000 && miss.key !== t.key.def.k) {
    const mx = (miss.x - (r.left + r.width / 2)) / r.width;
    const my = (miss.y - (r.top + r.height / 2)) / r.height;
    if (Math.abs(mx) < 1.3 && Math.abs(my) < 1.3) aim.record(t.key.def.k, mx, my, 3);
  }
  s.missTap = null;
  if (!t.slid && Math.abs(nx) < 0.75 && Math.abs(ny) < 0.75) aim.record(t.key.def.k, nx, ny);
  s.lastTap = { x: t.x0, y: t.y0, key: t.key.def.k, at: now };
}

// ============================================
// Select mode
// ============================================

function enterSelect() {
  const el = s.target;
  if (!el) return;
  s.select.on = true;
  if (el.selectionStart !== el.selectionEnd) {
    s.select.anchor = el.selectionStart;
    s.select.focus = el.selectionEnd;
  } else {
    s.select.anchor = s.select.focus = el.selectionStart;
  }
  s.clipsOpen = false;
  closeClips();
  renderBar();
}

function exitSelect(collapse) {
  const el = s.target;
  s.select.on = false;
  closeClips();
  if (collapse && el) setCaret(s.select.focus);
  renderBar();
  schedulePredictions();
}

function syncSelectFromField() {
  const el = s.target;
  if (!el) return;
  const backward = el.selectionDirection === 'backward';
  s.select.anchor = backward ? el.selectionEnd : el.selectionStart;
  s.select.focus = backward ? el.selectionStart : el.selectionEnd;
}

function applySelection() {
  const el = s.target;
  const { anchor, focus } = s.select;
  const start = Math.min(anchor, focus);
  const end = Math.max(anchor, focus);
  el.setSelectionRange(start, end, focus < anchor ? 'backward' : 'forward');
  s.expectedCaret = el.selectionStart;
  keepCaretVisible();
  renderBar();
}

// Space-bar drag while selecting moves the selection's free end
function moveSelection(t, x, y) {
  const el = s.target;
  const chars = Math.trunc((x - t.ax) / TRACKPAD_CHAR_PX);
  if (chars) {
    t.ax += chars * TRACKPAD_CHAR_PX;
    s.select.focus = Math.max(0, Math.min(el.value.length, s.select.focus + chars));
    applySelection();
  }
  const lines = Math.trunc((y - t.ay) / TRACKPAD_LINE_PX);
  if (lines && el.tagName === 'TEXTAREA') {
    t.ay += lines * TRACKPAD_LINE_PX;
    s.select.focus = caretAfterLineMove(el.value, s.select.focus, lines);
    applySelection();
  }
}

function rangeAround(kind) {
  const el = s.target;
  const v = el.value;
  const pos = s.select.focus;
  if (kind === 'all') return [0, v.length];
  if (kind === 'word') {
    let a = pos;
    let b = pos;
    while (a > 0 && /[\w'’]/.test(v[a - 1])) a--;
    while (b < v.length && /[\w'’]/.test(v[b])) b++;
    if (a === b && a > 0) { // caret after a space: take the previous word
      b = a;
      while (b > 0 && /\s/.test(v[b - 1])) b--;
      a = b;
      while (a > 0 && /[\w'’]/.test(v[a - 1])) a--;
    }
    return [a, b];
  }
  if (kind === 'sentence') {
    let a = pos;
    while (a > 0 && !/[.!?\n]/.test(v[a - 1])) a--;
    while (a < pos && /\s/.test(v[a])) a++;
    let b = pos;
    while (b < v.length && !/[.!?\n]/.test(v[b])) b++;
    if (b < v.length && /[.!?]/.test(v[b])) b++;
    return [a, b];
  }
  // paragraph: the current line (a list item or paragraph)
  const a = v.lastIndexOf('\n', pos - 1) + 1;
  let b = v.indexOf('\n', pos);
  if (b === -1) b = v.length;
  return [a, b];
}

function runCommand(cmd) {
  const el = s.target;
  if (!el) return;
  if (['word', 'sentence', 'paragraph', 'all'].includes(cmd)) {
    const [a, b] = rangeAround(cmd);
    s.select.anchor = a;
    s.select.focus = b;
    applySelection();
    return;
  }
  const text = el.value.slice(el.selectionStart, el.selectionEnd);
  if (cmd === 'copy' && text) {
    clips.push(text);
    copyToSystem(text);
    s.pasteHintUntil = Date.now() + 60000;
    s.select.focus = el.selectionEnd;
    exitSelect(true);
    flashNote('Copied');
  } else if (cmd === 'cut' && text) {
    clips.push(text);
    copyToSystem(text);
    deleteSelection(); // native delete keeps it undoable with ↶
    s.pasteHintUntil = Date.now() + 60000;
    exitSelect(false);
    afterEdit();
    flashNote('Cut');
  } else if (cmd === 'paste') {
    const clip = clips.latest();
    if (clip) pasteText(clip.text);
    else pasteFromSystem();
  } else if (cmd === 'case') {
    cycleWordCase();
    syncSelectFromField();
    renderBar();
  }
}

function copyToSystem(text) {
  // The field's own selection makes execCommand('copy') reliable on iOS
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch { /* unsupported */ }
  if (!ok && navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
}

function pasteText(text) {
  const wasSelecting = s.select.on;
  if (wasSelecting) s.select.on = false;
  closeClips();
  insert(text);
  s.revert = null;
  s.autoSpace = false;
  s.pasteHintUntil = 0;
  afterEdit();
  renderBar();
}

async function pasteFromSystem() {
  if (!navigator.clipboard?.readText) {
    flashNote('Nothing to paste');
    return;
  }
  try {
    // iOS shows its own "Paste" confirmation bubble here
    const text = await navigator.clipboard.readText();
    if (text) pasteText(text);
    else flashNote('Clipboard is empty');
  } catch {
    flashNote('Paste not allowed');
  }
}

function pasteFromHistory(which) {
  if (which === 'system') {
    closeClips();
    pasteFromSystem();
    return;
  }
  const clip = clips.list()[Number(which)];
  if (clip) pasteText(clip.text);
}

function openClips() {
  const panel = s.barEl.querySelector('.pk-clips');
  const list = clips.list();
  panel.innerHTML = `
    <div class="pk-clips-title">Clipboard</div>
    ${list.map((c, i) => `<button class="pk-clip" data-clip="${i}">${escapeHtml(clips.preview(c.text, 60))}</button>`).join('')}
    <button class="pk-clip pk-clip-system" data-clip="system">Paste from iPhone clipboard…</button>`;
  panel.hidden = false;
  s.clipsOpen = true;
  renderSelectionPreview();
  if (!s.select.on) paintScrollHint();
}

function closeClips() {
  const panel = s.barEl?.querySelector('.pk-clips');
  if (panel) panel.hidden = true;
  s.clipsOpen = false;
  if (s.barEl) renderSelectionPreview();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}
