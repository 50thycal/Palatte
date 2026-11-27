import Foundation

/// Everything the keyboard needs, wired together: the language engine, the
/// typing session and the Fix key, for the active profile. Switching profile
/// swaps the vocabulary, phrases, starters, shortcuts and fixes at once.
public final class Brain {
    public let engine: LanguageEngine
    public let session: TypingSession
    public private(set) var profile: Profile
    public private(set) var fixer: Fixer

    public init(words: [String], profile: Profile = .plain, now: @escaping () -> Date = Date.init) {
        engine = LanguageEngine(words: words)
        session = TypingSession(engine: engine, now: now)
        self.profile = profile
        fixer = Fixer(engine: engine, profile: profile)
        activate(profile)
    }

    public func activate(_ profile: Profile) {
        self.profile = profile
        engine.personal = profile.words
        engine.phraseModel = profile.bigrams.isEmpty && profile.trigrams.isEmpty ? nil : ProfilePhraseModel(profile)
        engine.setStarters(profile.starters)
        session.shortcuts = ShortcutTable(profile.shortcuts.isEmpty ? ShortcutTable.defaults : profile.shortcuts)
        session.reset()
        fixer = Fixer(engine: engine, profile: profile)
    }

    /// Run a hotkey's built-in action over the text before the caret.
    public func run(action: String, before: String) -> Edit {
        switch action {
        case "fix":
            let fixed = fixer.fix(before)
            return fixed == before ? .none : Edit(delete: before.count, insert: fixed)
        default:
            return .none
        }
    }
}
