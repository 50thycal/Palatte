/**
 * palate-keys: a touch keyboard for web apps and games.
 *
 *   import { init, setHotkeys } from 'palate-keys';
 *   import 'palate-keys/css/keyboard.css';
 *   init({ hotkeys: [...] });
 *
 * Mark any <input> or <textarea> with data-pk.
 */

export * from './keyboard.js';
export * as lang from './language.js';
export { DEFAULT_SHORTCUTS, validate as validateShortcut } from './shortcuts.js';
export { LAYOUTS, ACCENTS } from './layouts.js';
