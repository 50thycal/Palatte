# Key Palette

A native iOS keyboard that knows what you're working on. Pick a **profile** (the
cargo ship game, a novel, work email…) and the keyboard favours that project's
words, never "corrects" them, suggests phrases from your own writing, and shows
your own **hotkey** row. Swipe up on any key for its number or symbol.

> Status: in development. The typing engine (`KeyPaletteCore`) is finished and
> tested; the keyboard view, the extension and the app compile in CI but have not
> been run on a phone yet (that needs an Apple Developer account). See
> [docs/DESIGN.md](docs/DESIGN.md).

## Layout

| Path | What |
| --- | --- |
| `Sources/KeyPaletteCore` | Pure Swift: language engine, typing session, profiles, Fix key, store. Builds and tests anywhere, Linux included. |
| `Sources/KeyPaletteUI` | The UIKit keyboard view, shared by the extension and the app's playground. |
| `Keyboard/` | The keyboard extension (`UIInputViewController`). |
| `App/` | The container app (SwiftUI): setup, profiles, a playground. |
| `Data/` | The English word list and the bundled profiles. |
| `project.yml` | The Xcode project, generated with XcodeGen. |

## Build and test

```sh
swift test                 # the engine, on any machine
swift test -c release -Xswiftc -enable-testing   # and its speed budget
xcodegen generate && open KeyPalette.xcodeproj    # on a Mac
```

CI (`.github/workflows/keypalette-ios.yml`) runs the tests and compiles the app and
extension for the simulator, unsigned.

## Origin

The engine is a port of Palate Keys (`packages/palate-keys`, JavaScript), the web
keyboard that already runs in Palate and the Straitwatch game's note boxes. The
Cargo Ship profile is generated from that game's note keyboard data.
