/**
 * Key-press haptics.
 *
 * Mobile Safari has no Vibration API. Since iOS 18, toggling an
 * <input type="checkbox" switch> produces a system haptic tick, so a hidden
 * switch is clicked on each key press. Android uses navigator.vibrate.
 */

let label = null;
let enabled = true;

export function setEnabled(value) {
  enabled = value;
}

function ensureSwitch() {
  if (label) return label;
  label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  return label;
}

export function tick() {
  if (!enabled) return;
  if (navigator.vibrate) {
    navigator.vibrate(6);
    return;
  }
  const active = document.activeElement;
  ensureSwitch().click();
  // Never let the hidden switch steal focus from the text field
  if (active && document.activeElement !== active) active.focus({ preventScroll: true });
}
