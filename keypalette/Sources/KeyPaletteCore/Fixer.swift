import Foundation

/// The Fix key: correct a stretch of text in one go. Known typos from the
/// profile first, then dictation mishears (regex rules from the profile), then
/// the spell corrector on what's left. Contractions and stretched words
/// ("wayyyy") are left alone.
public struct Fixer {
    public var typoFixes: [String: String]
    public var phraseFixes: [PhraseFix]
    public var engine: LanguageEngine

    public init(engine: LanguageEngine, profile: Profile = .plain) {
        self.engine = engine
        self.typoFixes = profile.typoFixes
        self.phraseFixes = profile.phraseFixes
    }

    private static let wordRegex = try! NSRegularExpression(pattern: "[A-Za-z]+")
    private static let tokenRegex = try! NSRegularExpression(pattern: "[A-Za-z]+(?:['\u{2019}][A-Za-z]+)*")
    private static let stretched = try! NSRegularExpression(pattern: "(.)\\1{2,}", options: .caseInsensitive)

    private static func replace(in s: String, regex: NSRegularExpression, _ transform: (String, Int) -> String) -> String {
        let ns = s as NSString
        var out = ""
        var last = 0
        for m in regex.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            out += transform(ns.substring(with: m.range), m.range.location)
            last = m.range.location + m.range.length
        }
        out += ns.substring(from: last)
        return out
    }

    public func fix(_ text: String) -> String {
        var out = Self.replace(in: text, regex: Self.wordRegex) { w, _ in
            guard let fix = typoFixes[w.lowercased()] else { return w }
            return LanguageEngine.matchCase(template: w, word: fix)
        }
        for rule in phraseFixes {
            guard let re = try? NSRegularExpression(pattern: rule.pattern, options: .caseInsensitive) else { continue }
            out = re.stringByReplacingMatches(in: out, range: NSRange(location: 0, length: (out as NSString).length),
                                              withTemplate: rule.replacement)
        }
        let snapshot = out
        out = Self.replace(in: snapshot, regex: Self.tokenRegex) { w, at in
            if w.contains("'") || w.contains("\u{2019}") { return w }
            let whole = NSRange(location: 0, length: (w as NSString).length)
            if Self.stretched.firstMatch(in: w, range: whole) != nil { return w }
            let before = (snapshot as NSString).substring(to: at)
            return engine.correct(w, sentenceStart: TextHelpers.isSentenceStart(before)) ?? w
        }
        return out
    }
}
