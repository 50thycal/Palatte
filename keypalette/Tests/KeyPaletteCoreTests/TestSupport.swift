import Foundation
@testable import KeyPaletteCore

enum Fixtures {
    /// The 30k-word English list shipped in Data.
    static let words: [String] = {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Data/words-en.txt")
        let text = try! String(contentsOf: url, encoding: .utf8)
        return text.split(separator: "\n").map { String($0) }
    }()

    static func engine() -> LanguageEngine { LanguageEngine(words: words) }
}

/// A text field that only has a caret at its end: enough to drive a TypingSession.
final class Field {
    var text = ""
    let session: TypingSession
    let brain: Brain
    var clock = Date(timeIntervalSince1970: 1_800_000_000)

    init(profile: Profile = .plain) {
        var tick = Date(timeIntervalSince1970: 1_800_000_000)
        _ = tick
        brain = Brain(words: Fixtures.words, profile: profile)
        session = brain.session
        tick = clock
    }

    @discardableResult func apply(_ e: Edit) -> Field {
        text = e.applied(to: text)
        return self
    }
    func type(_ s: String) {
        for ch in s {
            if ch == " " { apply(session.space(before: text)) }
            else if ch == "\n" { apply(session.returnKey(before: text)) }
            else { apply(session.character(String(ch), before: text)) }
        }
    }
    func backspace() { apply(session.backspace(before: text)) }
}
