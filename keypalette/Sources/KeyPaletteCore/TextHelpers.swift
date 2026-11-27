import Foundation

/// Small pure helpers over the text before the caret, which is all a keyboard
/// extension is given (`documentContextBeforeInput`).
public enum TextHelpers {
    private static func isWordChar(_ c: Character) -> Bool {
        (c.isASCII && c.isLetter) || c == "'" || c == "\u{2019}"
    }

    /// The letters (and apostrophes) the caret is in or just after: "teh" in "so teh".
    public static func trailingWord(_ s: String) -> String {
        var out: [Character] = []
        for c in s.reversed() {
            if isWordChar(c) { out.append(c) } else { break }
        }
        return String(out.reversed())
    }

    /// The last run of non-space characters: where a shortcut trigger would be.
    public static func trailingToken(_ s: String) -> String {
        var out: [Character] = []
        for c in s.reversed() {
            if c.isWhitespace { break }
            out.append(c)
        }
        return String(out.reversed())
    }

    /// True at the start of the text, or after a full stop / ! / ? and spaces, or a new line.
    public static func isSentenceStart(_ before: String) -> Bool {
        var tail = ""
        for c in before.reversed() {
            if c.isWhitespace { tail.append(c) } else {
                return !tail.isEmpty && ".!?".contains(c) || tail.contains(where: \.isNewline)
            }
        }
        return true // empty or only whitespace
    }

    /// The last one or two words, lowercase: the context for predictions.
    public static func contextWords(_ before: String) -> [String] {
        let normalised = before.replacingOccurrences(of: "\u{2018}", with: "'").replacingOccurrences(of: "\u{2019}", with: "'")
        let words = normalised.split(whereSeparator: { !isWordChar($0) }).map { String($0).lowercased() }
        return Array(words.suffix(2))
    }

    /// True if the text ends with a sentence terminator and then only spaces.
    public static func endsSentence(_ s: String) -> Bool {
        for c in s.reversed() {
            if c.isWhitespace { continue }
            return ".!?".contains(c) || (s.last.map(\.isNewline) ?? false)
        }
        return false
    }

    /// Cycle a word's case: john -> John -> JOHN -> john.
    public static func nextCase(_ text: String) -> String {
        let words = text.split(whereSeparator: { !isWordChar($0) })
        if words.isEmpty { return text }
        if text == text.uppercased() { return text.lowercased() }
        if words.allSatisfy({ $0.first.map { $0 == Character($0.uppercased()) } ?? true }) { return text.uppercased() }
        return text.split(separator: " ", omittingEmptySubsequences: false)
            .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
            .joined(separator: " ")
    }
}
