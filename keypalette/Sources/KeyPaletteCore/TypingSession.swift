import Foundation

/// A change to make to the text field: delete characters before the caret,
/// insert text, then move the caret. Pure data, so the keyboard just applies it.
public struct Edit: Equatable, Sendable {
    public var delete: Int
    public var insert: String
    /// Move the caret back this many characters after inserting (a {cursor} marker).
    public var cursorBack: Int
    /// Move the caret forward this many characters after inserting.
    public var cursorForward: Int
    /// A word the person un-corrected: it is theirs from now on.
    public var learned: String?

    public init(delete: Int = 0, insert: String = "", cursorBack: Int = 0, cursorForward: Int = 0, learned: String? = nil) {
        self.delete = delete
        self.insert = insert
        self.cursorBack = cursorBack
        self.cursorForward = cursorForward
        self.learned = learned
    }

    public static let none = Edit()
    public var isEmpty: Bool { delete == 0 && insert.isEmpty && cursorBack == 0 && cursorForward == 0 }

    /// Apply to a string that ends at the caret (for tests and previews).
    public func applied(to before: String) -> String {
        String(before.dropLast(delete)) + insert
    }
}

public struct Suggestion: Equatable, Sendable {
    public enum Kind: Sendable { case literal, word, shortcut }
    public var label: String
    public var value: String
    public var kind: Kind
    public var primary: Bool
    /// The trigger a shortcut suggestion replaces.
    public var token: String?
    public var cursorBack: Int

    public init(label: String, value: String, kind: Kind, primary: Bool = false, token: String? = nil, cursorBack: Int = 0) {
        self.label = label
        self.value = value
        self.kind = kind
        self.primary = primary
        self.token = token
        self.cursorBack = cursorBack
    }
}

/// The typing behaviour, ported from Palate Keys: autocorrect on space and
/// punctuation (backspace right after undoes it and teaches the word), smart
/// punctuation spacing, double-space for a full stop, text shortcuts, and
/// suggestions. It sees only the text before the caret, because that is all a
/// keyboard extension is given. State lives here; edits come back as `Edit`s.
public final class TypingSession {
    public var autocorrect = true
    public var autoCapitalize = true
    public var autoPeriod = true
    public var shortcuts: ShortcutTable

    private let engine: LanguageEngine
    private let now: () -> Date

    private struct Revert {
        var original: String
        var corrected: String
        var terminator: String
        var isShortcut: Bool
    }

    private var revert: Revert?
    private var autoSpace = false
    private var lastKey = ""
    private var lastSpaceAt = Date.distantPast
    private var pending: (word: String, corr: String?)?

    private static let terminators: Set<Character> = [".", ",", "!", "?", ";", ":"]
    private static let doubleSpaceWindow: TimeInterval = 0.45

    public init(engine: LanguageEngine, shortcuts: ShortcutTable = ShortcutTable(), now: @escaping () -> Date = Date.init) {
        self.engine = engine
        self.shortcuts = shortcuts
        self.now = now
    }

    /// Forget what happened before (a new text field, a profile switch).
    public func reset() {
        revert = nil
        autoSpace = false
        lastKey = ""
        pending = nil
    }

    /// Text was inserted by something other than a key (a hotkey): forget any
    /// pending correction, so backspace deletes normally.
    public func noteExternalInsert() {
        revert = nil
        autoSpace = false
        lastKey = "hotkey"
    }

    public func shouldCapitalize(before: String) -> Bool {
        autoCapitalize && TextHelpers.isSentenceStart(before)
    }

    // MARK: Keys

    /// A character key. Punctuation first fixes or expands the word before it.
    public func character(_ ch: String, before: String) -> Edit {
        revert = nil
        guard ch.count == 1, let c = ch.first else {
            autoSpace = false
            lastKey = ch
            return Edit(insert: ch)
        }
        if Self.terminators.contains(c) {
            if autoSpace && before.hasSuffix(" ") {
                // "word |" + "." -> "word. |"
                autoSpace = true
                lastKey = ch
                return Edit(delete: 1, insert: ch + " ")
            }
            var edit = applyShortcut(before: before) ?? applyAutocorrect(before: before, terminator: ch) ?? Edit()
            edit.insert += ch
            if edit.cursorBack > 0 { edit.cursorBack += 1 }
            if revert != nil { revert?.terminator = ch }
            autoSpace = false
            lastKey = ch
            return edit
        }
        autoSpace = false
        lastKey = ch
        return Edit(insert: ch)
    }

    public func space(before: String) -> Edit {
        let t = now()
        // Double-tap space -> ". "
        if lastKey == "space" && t.timeIntervalSince(lastSpaceAt) < Self.doubleSpaceWindow && autoPeriod,
           let last = before.dropLast().last, before.last == " ",
           last.isLetter || last.isNumber || ")\"'\u{2019}".contains(last) {
            lastKey = "."
            lastSpaceAt = .distantPast
            autoSpace = false
            revert = nil
            return Edit(delete: 1, insert: ". ")
        }
        lastKey = "space"
        lastSpaceAt = t
        if autoSpace {
            // A suggestion already added the space; this tap only arms double-space
            autoSpace = false
            return .none
        }
        revert = nil
        var edit = applyShortcut(before: before) ?? applyAutocorrect(before: before, terminator: " ") ?? Edit()
        edit.insert += " "
        if edit.cursorBack > 0 { edit.cursorBack += 1 }
        if revert != nil { revert?.terminator = " " }
        return edit
    }

    public func returnKey(before: String) -> Edit {
        autoSpace = false
        revert = nil
        var edit = applyShortcut(before: before) ?? applyAutocorrect(before: before, terminator: "\n") ?? Edit()
        edit.insert += "\n"
        if edit.cursorBack > 0 { edit.cursorBack += 1 }
        revert = nil
        lastKey = "enter"
        return edit
    }

    public func backspace(before: String) -> Edit {
        if let r = revert, before.hasSuffix(r.corrected + r.terminator) {
            // Undo the autocorrection and remember the word
            revert = nil
            autoSpace = false
            return Edit(delete: (r.corrected + r.terminator).count, insert: r.original, learned: r.isShortcut ? nil : r.original)
        }
        revert = nil
        autoSpace = false
        lastKey = "backspace"
        return before.isEmpty ? .none : Edit(delete: 1)
    }

    /// The person tapped a suggestion.
    public func accept(_ s: Suggestion, before: String, after: String = "") -> Edit {
        revert = nil
        autoSpace = true
        lastKey = "prediction"
        if s.kind == .shortcut, let token = s.token {
            if s.cursorBack > 0 {
                autoSpace = false
                return Edit(delete: token.count, insert: s.value, cursorBack: s.cursorBack)
            }
            return Edit(delete: token.count, insert: s.value + " ")
        }
        let partial = TextHelpers.trailingWord(before)
        let needsSpace = !(after.first?.isWhitespace ?? false)
        var edit = Edit(delete: partial.count, insert: s.value + (needsSpace ? " " : ""))
        if !needsSpace { edit.cursorForward = 1 }
        if s.kind == .literal && !engine.isKnown(s.value) { edit.learned = s.value }
        return edit
    }

    // MARK: Autocorrect and shortcuts

    private func applyAutocorrect(before: String, terminator: String) -> Edit? {
        guard autocorrect else { return nil }
        let word = TextHelpers.trailingWord(before)
        if word.isEmpty || word.replacingOccurrences(of: "'", with: "").isEmpty { return nil }
        let beforeWord = String(before.dropLast(word.count))
        // Don't touch words glued to digits, URLs, #tags or @handles
        if let prev = beforeWord.last, prev.isLetter || prev.isNumber || "_#@/.:".contains(prev) {
            let afterDot = prev == "." && (beforeWord.dropLast().last?.isWhitespace ?? true)
            if !afterDot { return nil }
        }
        if terminator == "." && ["www", "http", "https"].contains(word.lowercased()) { return nil }

        let sentenceStart = autoCapitalize && TextHelpers.isSentenceStart(beforeWord)
        let corr = pending?.word == word ? pending?.corr : engine.correct(word, sentenceStart: sentenceStart)
        guard let corr, corr != word else { return nil }
        revert = Revert(original: word, corrected: corr, terminator: "", isShortcut: false)
        return Edit(delete: word.count, insert: corr)
    }

    private func applyShortcut(before: String) -> Edit? {
        let token = TextHelpers.trailingToken(before)
        guard !token.isEmpty, let exp = shortcuts.expansion(for: token, now: now()) else { return nil }
        revert = Revert(original: token, corrected: exp.text, terminator: "", isShortcut: true)
        return Edit(delete: token.count, insert: exp.text, cursorBack: exp.cursorBack)
    }

    // MARK: Suggestions

    /// Up to three suggestions for the bar: the primary one in the middle.
    public func suggestions(before: String) -> [Suggestion] {
        let partial = TextHelpers.trailingWord(before)
        let head = String(before.dropLast(partial.count))
        let context = TextHelpers.endsSentence(head) ? [] : TextHelpers.contextWords(head)
        let sentenceStart = autoCapitalize && TextHelpers.isSentenceStart(head)

        // A typed shortcut trigger previews its expansion
        let token = TextHelpers.trailingToken(before)
        if !token.isEmpty, let exp = shortcuts.expansion(for: token, now: now()) {
            pending = nil
            let preview = exp.text.count > 24 ? String(exp.text.prefix(23)) + "…" : exp.text
            return [
                Suggestion(label: "“\(token)”", value: token, kind: .literal),
                Suggestion(label: "→ \(preview)", value: exp.text, kind: .shortcut, primary: true, token: token, cursorBack: exp.cursorBack),
            ]
        }

        if !partial.isEmpty {
            let comps = engine.complete(prefix: partial, context: context, k: 4)
            let counts = engine.contextCounts(for: context)
            let corr = autocorrect ? engine.correct(partial, sentenceStart: sentenceStart, contextCounts: counts) : nil
            pending = (partial, corr)
            let capitalised = sentenceStart || (partial.first.map { $0 != Character($0.lowercased()) } ?? false)
            let rest = comps
                .map { capitalised ? LanguageEngine.matchCase(template: partial, word: $0) : $0 }
                .filter { $0 != corr && $0.lowercased() != partial.lowercased() }
            if let corr {
                return [Suggestion(label: "“\(partial)”", value: partial, kind: .literal),
                        Suggestion(label: corr, value: corr, kind: .word, primary: true)]
                    + rest.prefix(1).map { Suggestion(label: $0, value: $0, kind: .word) }
            }
            let exact = engine.isKnown(partial)
            return [Suggestion(label: exact ? partial : "“\(partial)”", value: partial, kind: .literal)]
                + rest.prefix(2).enumerated().map { Suggestion(label: $1, value: $1, kind: .word, primary: $0 == 0) }
        }

        pending = nil
        let words = engine.nextWords(context: context, k: 3, sentenceStart: sentenceStart)
            .map { sentenceStart ? $0.prefix(1).uppercased() + $0.dropFirst() : $0 }
        // The most likely word goes in the middle, where the eye lands first
        var slots: [Suggestion] = []
        if words.count > 1 { slots.append(Suggestion(label: words[1], value: words[1], kind: .word)) }
        if let w = words.first { slots.append(Suggestion(label: w, value: w, kind: .word, primary: true)) }
        if words.count > 2 { slots.append(Suggestion(label: words[2], value: words[2], kind: .word)) }
        return slots
    }
}
