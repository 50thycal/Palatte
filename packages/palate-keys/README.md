# palate-keys

One touch keyboard for every web app and game you build. It replaces the
system keyboard inside the page, so it looks and behaves the same everywhere
(iOS Safari, a PWA, or a Capacitor app).

- **Typing**: swipe up on a key for its symbol or digit, hold for accents,
  swipe down to change a word's case, swipe left on backspace to delete words,
  hold space for a caret trackpad, double-space for a period.
- **Smart**: predictions, autocorrect that learns, shift that follows the
  sentence, and it learns where you actually tap each key.
- **Editing**: Select mode (word, sentence, paragraph, all), cut, copy, paste
  and a clipboard history that never triggers iOS's paste bubble.
- **Yours**: hotkeys, extra layers, text shortcuts and the colours, all defined
  by the host app. Palate, a game and the next app share this one code base.

No dependencies, no build step needed (plain ES modules + one CSS file).

## Use it

```js
import { init, setHotkeys } from 'palate-keys';
import 'palate-keys/css/keyboard.css';

init({ mode: 'auto' });          // 'auto' = touch screens only
```

```html
<input data-pk placeholder="Ship name">
<textarea data-pk data-pk-hotkeys="chat"></textarea>
```

Any `<input>` or `<textarea>` with `data-pk` gets the keyboard. Fields you
create later are picked up with `decorate(root)`. Canvas games need a real
text field behind the canvas: style an `<input data-pk>` as part of your UI.
Use `enterkeyhint="send"` to relabel the return key.

The keyboard sets `--kb-h` on `<html>` (its height, `0px` when hidden) and
`html.pk-open` while it is up: use them to lift your own layout.

### Options for `init`

| option | |
| --- | --- |
| `mode` | `'auto'` \| `'always'` \| `'off'` |
| `autocorrect`, `haptics` | booleans (default on) |
| `dictionary` | URL of the word list, or `false` to skip. Default: the list shipped here, resolved next to the module (Vite bundles it) |
| `storage`, `storagePrefix` | where learned aim and clips are kept: any `{getItem,setItem,removeItem}`; default `localStorage`, prefix `palate_` |
| `hotkeys` | `[hotkey]` for all fields, or `{ setName: [hotkey] }` |
| `hotkeyLayers` | which layers show the strip (default `['letters']`) |
| `layouts` | `{ name: rows }` extra layers |
| `onLearn(word)`, `onVisibility(bool)` | callbacks |

Runtime: `setMode`, `setAutocorrect`, `setHaptics`, `setHotkeys`,
`registerLayout`, `setShortcuts`, `setAction`, `flash`, `decorate`, `refresh`.
Language hooks live in `lang` (`setLearnedWords`, `setContextSource`,
`setDictionary`, `setPersonalVocabulary`): feed it your game's own vocabulary so
ship names, places and slang are predicted and not "corrected".

## Hotkeys

A strip of your own keys above the letters:

```js
setHotkeys([
  { label: 'GG', insert: 'good game ', alt: 'thank you ', hold: { label: 'gl', insert: 'good luck ' } },
  { label: 'Hi', insert: 'Hello {cursor}!' },
  { label: 'Name', run: (ctx) => ctx.insert(randomShipName()) },
  { label: 'Send', run: (ctx) => ctx.submit() },
  { label: '⚙︎', layer: 'fn' },
]);
```

- `tap` = `insert` and/or `run(ctx)`; `alt` = swipe up; `hold` = long press.
  `alt`/`hold` are a string to insert or `{ label, insert?, run? }`.
- `insert` text supports `{date} {time} {day} {iso}` and a `{cursor}` marker.
- `{ label, layer }` jumps to a layer. `style: 'plain'` drops the accent colour.
- Per-field sets: `setHotkeys('chat', [...])` and `<input data-pk data-pk-hotkeys="chat">`.
  A field with no matching set shows no strip.
- Each hotkey edit goes through the native text editing path, so the field's
  own undo (the keyboard's ↶ key) works.

`ctx`: `text`, `caret`, `selection {start,end,text}`, `el`, `insert(text)`,
`replace(start,end,text)`, `replaceAll(text)`, `clear()`, `setCaret(pos)`,
`backspace()`, `submit()` (return key: `pk-enter` event on inputs), `setLayer(name)`,
`flash(message)`, `hide()`.

## Layers

```js
registerLayout('fn', [
  [{ k: 'a', alt: '1' }, 'b', { action: 'custom', label: 'x', run: (ctx) => ctx.insert('x') }],
  [{ action: 'layer', to: 'letters', label: 'ABC', w: 1.4 }],
]);
```

Key forms: `'a'`, `{ k, alt }`, `{ action: 'shift'|'backspace'|'space'|'enter'|'undo'|'redo' }`,
`{ action: 'layer', to, label }`, and hotkeys (`label` + `insert`/`run`). `w` is width in key units.

## Text shortcuts

`setShortcuts([{ trigger: ';gg', expansion: 'good game' }])`: typing the
trigger and then a space or punctuation expands it.

## Theme

Override the tokens (defaults follow the system dark mode; force one with
`<html data-theme="dark|light">`):

```css
:root {
  --kb-bg: #0b1620;  --kb-key: #1c2f3f;  --kb-key-action: #12212d;
  --kb-key-down: #2c4760;  --kb-text: #dfeaf2;  --kb-hot: #2f7fd0;
}
```

## Sharing it across projects

This folder is the single source of truth. Projects consume it as a copy plus
a version stamp (`tools/sync-keys.mjs` in the game); to move it to its own repo
later, copy this folder as the repo root: it has its own `package.json`.
Rebuild the dictionary with `python3 build-dictionary.py`.

## Tests

Unit: `npm test` in the Palate root. Touch behaviour: `tests/e2e/keyboard.e2e.mjs`,
`select.e2e.mjs`, `hotkeys.e2e.mjs` (they need `npm run dev`).
