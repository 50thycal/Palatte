# Key Palette: design

## What it is, and why it isn't just another keyboard

Research (Nov 2026) found keyboards for each piece but none that combine them:
swipe-up symbols (Typefinity, ReBoard, Typewise's swipe-up capitalise; several
are stale or have flaky gestures), snippets and hotkeys (ShortKeys, TypeSnip,
WordBoard, SnippetKeys: crowded, mostly tap-to-paste, small free tiers), a custom
dictionary (Apple's is one global list; Grammarly and Wispr Flow keep personal
ones, also global), and, as far as the search could tell, **no keyboard that
switches whole vocabularies by what you are working on**. That last one is the
bet. The rest is table stakes done well.

So the product is **profiles**:

- a profile is what you're working on (Cargo Ship, a novel, work);
- one tap on the chip in the keyboard's bar switches it;
- it sets the vocabulary (never corrected, suggested as you type), the phrases
  suggested after a word, the sentence openers, the text shortcuts, the typo and
  dictation fixes, and the **hotkey row**.

iOS gives a keyboard no way to know which app it's in (Apple DTS: no public API; a
private workaround stopped working in iOS 26.4), so the profile is chosen by the
person, which is also what they asked for.

## Architecture

```
KeyPaletteCore (pure Swift, tested on Linux and macOS)
  Layouts        key layers, swipe-up alternates, QWERTY neighbours
  EditDistance   keyboard-aware Damerau-Levenshtein (neighbour keys are cheap)
  LanguageEngine dictionary, autocorrect, completions, next words
  TypingSession  smart punctuation, double-space full stop, revert on backspace,
                 shortcuts, suggestions: all as pure `Edit`s
  Profile        the profile file format; ProfilePhraseModel
  Fixer          the Fix key: typos, dictation mishears, then the spell corrector
  Brain          engine + session + fixer for the active profile
  ProfileStore   profiles as JSON files, active profile, learned words
KeyPaletteUI (UIKit; compiles to nothing without UIKit)
  KeyboardView   hotkey row, suggestion bar + profile chip, typing layers
  KeyView        one key: tap, swipe up, hold, trackpad drag, repeat
  KeyboardHost   what a host provides (text proxy, or the playground's text view)
Keyboard/        the extension: a UIInputViewController hosting KeyboardView
App/             SwiftUI: setup steps, profile list and editor, a playground
```

The engine is a port of Palate Keys' JavaScript (same behaviour, same tests). One
deliberate change: the next-word tie-break by general English frequency is 0.005,
not 0.02, so a person's own phrase counts win ("good" → "overall", not "but").

The typing session only ever sees the text before the caret, because that is all a
keyboard extension is given (`documentContextBeforeInput`). Edits are data
(`delete`, `insert`, caret moves), applied by the host.

## Profile file (`keypalette-profile`, schema 1)

JSON. Only `id` and `name` are required.

```json
{
  "schema": 1, "id": "cargo-ship", "name": "Cargo Ship", "icon": "⚓️", "colorHex": "#17607A",
  "words": { "railgun": 3, "saltgate": 3 },
  "starters": ["Good", "Make"],
  "bigrams": { "good": { "overall": 13, "but": 12 } },
  "trigrams": { "good overall": { "but": 5 } },
  "typoFixes": { "missle": "missile" },
  "phraseFixes": [ { "pattern": "\\bdual (?:weld|wheel)\\b", "replacement": "Dual Wield" } ],
  "shortcuts": [ { "trigger": ";gg", "expansion": "good game" } ],
  "hotkeys": [
    { "label": "✓ Fix", "action": "fix" },
    { "label": "Good", "insert": "Good overall. ",
      "alt": { "label": "works", "insert": "Works as expected. " },
      "hold": { "label": "better", "insert": "Much better. " } }
  ]
}
```

- `words`: weight 2 or more means "known": never autocorrected, favoured in
  suggestions, and a target when correcting a typo.
- `insert` text takes `{date} {time} {day} {iso}` and a `{cursor}` marker.
- A hotkey with `alt` gets a swipe-up, with `hold` a long press.
- `phraseFixes` are case-insensitive regular expressions (`$1` for groups).

`Data/profiles/cargo-ship.json` is generated from the Straitwatch game's note
keyboard (its vocabulary from the game data, the phrase model from 201 playtest
notes, its typo and dictation fixes). Because a profile is plain JSON, a project can
export its own.

## Constraints from iOS, and what to verify on a real phone

These are the things an Apple Developer account and a device will settle. None is
tested yet:

1. **Reading the shared profiles.** The extension reads profiles from the App Group
   container. Without Full Access this should work for reading, but writes from the
   extension may not persist; so the extension keeps its own learned words and
   active profile in its own defaults, and falls back to the profiles bundled in its
   resources if the container is empty. Check on device.
2. **`documentContextBeforeInput` lag.** The text before the caret may lag right after
   an edit. If it does, the view keeps a shadow of its own edits until the next
   `textDidChange`.
3. **No microphone.** Custom keyboards can't use it. The setup screen says to tap 🌐
   and use Apple's keyboard for dictation. (Wispr Flow bounces to its app for a mic
   session; that is a possible later feature with App Review risk.)
4. **Not in secure fields**, and the system can swap keyboards in some fields.
5. **Memory limit** for extensions. The word list is 30k words (about 3 MB in
   memory); a much bigger one needs measuring.
6. **iOS 26 oddities** reported by other keyboard developers (a gray bar above the
   keyboard; extensions disappearing from the list). Test on current iOS.
7. **Haptics** need Full Access; the key click sound doesn't. Haptics are off.
8. **Height and the notch.** The view sizes itself from the vertical size class and
   keeps its keys inside the safe area. Check landscape on an island phone.

## Built since the first version

- **Profile from your own writing** (`ProfileBuilder`): paste notes, messages or a
  draft (or pick a text file) and it keeps the words you use often and any names
  (weighted by use, never corrected), the phrases you write twice or more, and how
  you open sentences. Same method as the Straitwatch note keyboard's model. The
  text is read on the phone and never leaves it.
- **Hotkey editor in the app:** label, tap text, swipe-up and hold text, a Fix key,
  reorder and delete.

## Not built yet (roadmap)

1. Run it on a phone (needs the developer account: register the two bundle ids and
   the App Group `group.com.appfarm.keypalette`, then a TestFlight pipeline).
2. Long-press accents, swipe-down case change, swipe-left word delete, key preview
   bubbles, learned tap aim (all exist in Palate Keys).
3. Edit the phrase model by hand; import and export profiles from inside the app
   (import exists; export doesn't); a game exporting its own.
4. A bigger dictionary, other languages.
5. App Store assets, privacy policy (nothing is collected), pricing.

## Decisions

- **Name:** Key Palette (an artist's palette: creative and software together).
- **Bundle ids:** `com.appfarm.keypalette` and `.keyboard`; App Group
  `group.com.appfarm.keypalette`. Provisional until the developer account exists.
- **No Full Access:** the keyboard asks for none; nothing leaves the phone.
- **Where it lives:** in the Palate repo under `keypalette/`, self-contained, so it
  moves to its own repository by copying the folder (and its workflow).
