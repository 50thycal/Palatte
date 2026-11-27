#if canImport(UIKit)
import UIKit
import KeyPaletteCore

/// What the keyboard view needs from wherever it lives: the real text field
/// (through a keyboard extension's `textDocumentProxy`) or the app's playground.
public protocol KeyboardHost: AnyObject {
    var contextBefore: String { get }
    var contextAfter: String { get }
    /// iOS asks every keyboard to offer a way to switch to the next one.
    var showsGlobeKey: Bool { get }
    func perform(_ edit: Edit)
    func moveCursor(by offset: Int)
    func switchKeyboard()
    /// The person un-corrected a word: it is theirs from now on.
    func didLearn(_ word: String)
}

public extension KeyboardHost {
    func didLearn(_ word: String) {}
}
#endif
