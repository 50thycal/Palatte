import Foundation

/// Builds a profile from a person's own writing: the words they use, the
/// phrases they write, how they open sentences. Paste in notes, messages or a
/// draft and the keyboard learns that vocabulary. Same method as the Straitwatch
/// note keyboard's model, which was built from 201 playtest notes.
public struct ProfileBuilder {
    /// Is this a word the general dictionary knows?
    private let isKnown: (String) -> Bool

    /// A phrase must appear this often to be kept.
    public var minPhraseCount = 2
    /// A habitual word must appear this often to be weighted.
    public var minWordCount = 2
    public var maxFollowersPerWord = 8
    public var maxStarters = 8

    public init(isKnown: @escaping (String) -> Bool) {
        self.isKnown = isKnown
    }

    public init(engine: LanguageEngine) {
        self.isKnown = { engine.isKnown($0) }
    }

    private static func isWordChar(_ c: Character) -> Bool {
        (c.isASCII && c.isLetter) || c == "'" || c == "\u{2019}"
    }

    private struct Token {
        let word: String          // lowercase
        let capitalised: Bool     // was written with a capital
        let startsSentence: Bool
    }

    /// Words per sentence, never across a full stop, question mark or new line.
    private func sentences(_ text: String) -> [[Token]] {
        var out: [[Token]] = []
        let normalised = text.replacingOccurrences(of: "\u{2019}", with: "'").replacingOccurrences(of: "\u{2018}", with: "'")
        let parts = normalised.split(omittingEmptySubsequences: true, whereSeparator: { ".!?\n".contains($0) })
        for part in parts {
            var tokens: [Token] = []
            for raw in part.split(whereSeparator: { !Self.isWordChar($0) }) {
                let s = String(raw)
                guard s.contains(where: \.isLetter) else { continue }
                // A lone apostrophe or a stray quote isn't a word
                let trimmed = s.trimmingCharacters(in: CharacterSet(charactersIn: "'"))
                guard !trimmed.isEmpty else { continue }
                tokens.append(Token(word: trimmed.lowercased(),
                                    capitalised: trimmed.first.map { $0.isUppercase } ?? false,
                                    startsSentence: tokens.isEmpty))
            }
            if !tokens.isEmpty { out.append(tokens) }
        }
        return out
    }

    public func build(id: String, name: String, icon: String = "🎨", colorHex: String = "#3A6DF0", from texts: [String]) -> Profile {
        var counts: [String: Int] = [:]
        var midSentenceCaps: Set<String> = []
        var starters: [String: Int] = [:]
        var bigrams: [String: [String: Int]] = [:]
        var trigrams: [String: [String: Int]] = [:]

        for text in texts {
            for sentence in sentences(text) {
                let words = sentence.map(\.word)
                for (i, t) in sentence.enumerated() {
                    counts[t.word, default: 0] += 1
                    if t.capitalised && !t.startsSentence { midSentenceCaps.insert(t.word) }
                    if i == 0 { starters[t.word, default: 0] += 1 }
                    if i >= 1 { bigrams[words[i - 1], default: [:]][t.word, default: 0] += 1 }
                    if i >= 2 { trigrams["\(words[i - 2]) \(words[i - 1])", default: [:]][t.word, default: 0] += 1 }
                }
            }
        }

        // Vocabulary: words you use habitually, and words the dictionary doesn't
        // know that you use at all more than once, or capitalise mid-sentence
        // (names: "Saltgate", "Quentin"). Weight = how often.
        var words: [String: Double] = [:]
        for (w, n) in counts {
            let known = isKnown(w)
            if known {
                if n >= minWordCount { words[w] = Double(n) }
            } else if n >= minWordCount || midSentenceCaps.contains(w) {
                // never below 2: a weight of 2 is what makes a word "known"
                words[w] = Double(max(2, n))
            }
        }

        func keep(_ table: [String: [String: Int]]) -> [String: [String: Double]] {
            var out: [String: [String: Double]] = [:]
            for (head, nexts) in table {
                let kept = nexts.filter { $0.value >= minPhraseCount }
                    .sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
                    .prefix(maxFollowersPerWord)
                if !kept.isEmpty { out[head] = Dictionary(uniqueKeysWithValues: kept.map { ($0.key, Double($0.value)) }) }
            }
            return out
        }

        let openers = starters.filter { $0.value >= 3 }
            .sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
            .prefix(maxStarters)
            .map { $0.key == "i" ? "I" : $0.key.prefix(1).uppercased() + $0.key.dropFirst() }

        return Profile(id: id, name: name, icon: icon, colorHex: colorHex,
                       words: words, starters: Array(openers),
                       bigrams: keep(bigrams), trigrams: keep(trigrams))
    }
}
