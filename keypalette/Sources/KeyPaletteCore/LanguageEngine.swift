import Foundation

/// A word and how often (or how strongly) it follows what was typed.
public struct WeightedWord: Equatable, Sendable {
    public var word: String
    public var count: Double
    public init(word: String, count: Double) {
        self.word = word
        self.count = count
    }
}

/// Phrase statistics: what usually follows one or two words. A profile supplies
/// one built from the person's own writing.
public protocol PhraseModel {
    /// `context` is the last one or two words typed, lowercase.
    func next(after context: [String]) -> (bigrams: [WeightedWord], trigrams: [WeightedWord])
}

/// Dictionary, autocorrect, completions and next-word ranking, ported from
/// Palate Keys (language.js). Not thread-safe: use it from the main thread.
public final class LanguageEngine {
    private struct Entry {
        let text: String
        let bytes: [UInt8]
    }

    private var ranked: [String] = []
    private var rankOf: [String: Int] = [:]
    private var sorted: [String] = []
    private var byLength: [Int: [Entry]] = [:]
    private var letterCache: [String: [Character: Double]] = [:]
    private let scratch = EditDistance.Scratch()

    /// word -> weight (from a profile's vocabulary); a weight of 2 or more makes a word "known".
    public var personal: [String: Double] = [:] { didSet { letterCache.removeAll() } }
    /// Words the person explicitly kept (un-corrected).
    public var learned: Set<String> = []
    public var phraseModel: PhraseModel?

    private static let defaultStarters = ["I", "The", "I'm", "We", "It", "This", "What", "So"]
    public var starters: [String] = LanguageEngine.defaultStarters

    public init(words: [String]) {
        setDictionary(words)
    }

    public var dictionarySize: Int { ranked.count }

    public func setDictionary(_ words: [String]) {
        ranked = words.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        rankOf.removeAll()
        byLength.removeAll()
        for (i, w) in ranked.enumerated() {
            if rankOf[w] == nil { rankOf[w] = i }
            byLength[w.count, default: []].append(Entry(text: w, bytes: Array(w.utf8)))
        }
        sorted = rankOf.keys.sorted()
        letterCache.removeAll()
    }

    public func setStarters(_ words: [String]) {
        starters = words.isEmpty ? Self.defaultStarters : words
    }

    // MARK: Scoring

    private func logPrior(_ word: String) -> Double {
        let dict = rankOf[word].map { -log(Double($0) + 30) } ?? -11.5
        let p = personal[word] ?? 0
        return dict + (p > 0 ? 1.5 * log(1 + p) : 0)
    }

    public func isKnown(_ word: String) -> Bool {
        let w = word.lowercased()
        return rankOf[w] != nil || learned.contains(w) || (personal[w] ?? 0) >= 2
    }

    /// Give `word` the capitalisation pattern of `template`.
    public static func matchCase(template: String, word: String) -> String {
        if word == "I" || word.hasPrefix("I'") { return word }
        if template.count > 1 && template == template.uppercased() && template.contains(where: { $0.isUppercase }) {
            return word.uppercased()
        }
        if let first = template.first, first != Character(first.lowercased()) {
            return word.prefix(1).uppercased() + word.dropFirst()
        }
        return word
    }

    // MARK: Autocorrect

    /// The corrected word, or nil to leave it alone.
    public func correct(_ word: String, sentenceStart: Bool = false, contextCounts: [String: Double]? = nil) -> String? {
        if word.isEmpty || word.contains(where: { $0.isNumber || $0 == "_" }) { return nil }
        let lower = word.lowercased()

        if Contractions.leaveAlone.contains(lower) { return nil }
        if let fix = Contractions.fixes[lower] {
            if learned.contains(lower) { return nil }
            return fix.hasPrefix("I") ? fix : Self.matchCase(template: word, word: fix)
        }

        if isKnown(lower) { return nil }
        // Acronyms and mid-sentence capitalised words are probably names
        if word.count > 1 && word == word.uppercased() { return nil }
        if !sentenceStart && word.first != lower.first { return nil }

        let len = lower.count
        let maxCost = EditDistance.maxCost(forLength: len)
        if maxCost == 0 { return nil }

        let typed = EditDistance.Typed(lower)
        let lowerChars = Array(lower)
        var best: String?
        var bestScore = -Double.infinity

        func consider(_ cand: String, _ bytes: [UInt8]) {
            let cost = EditDistance.cost(typed: typed, target: bytes, limit: maxCost, scratch: scratch)
            if cost > maxCost { return }
            var score = logPrior(cand) - 3 * cost
            if let c = contextCounts?[cand] { score += 2 * c }
            if score > bestScore {
                bestScore = score
                best = cand
            }
        }

        for l in max(1, len - 2)...(len + 2) {
            for entry in byLength[l] ?? [] {
                let c = entry.bytes
                // Cheap filters before the full edit-distance computation
                if len < 6 {
                    if c[0] != typed.bytes[0] && !Self.neighbours(of: lowerChars[0], contains: entry.text.first) { continue }
                } else {
                    if c[0] != typed.bytes[0] && c[1] != typed.bytes[1] && c[0] != typed.bytes[1] { continue }
                }
                consider(entry.text, c)
            }
        }
        for (cand, count) in personal where count >= 2 && abs(cand.count - len) <= 2 && rankOf[cand] == nil {
            consider(cand, Array(cand.utf8))
        }
        return best.map { Self.matchCase(template: word, word: $0) }
    }

    private static func neighbours(of a: Character, contains b: Character?) -> Bool {
        guard let b else { return false }
        return Layouts.neighbours[a]?.contains(b) ?? false
    }

    // MARK: Phrase context

    private struct Shares {
        var tri: [String: Double] = [:]
        var bi: [String: Double] = [:]
    }

    private func share(_ list: [WeightedWord]) -> [String: Double] {
        let total = list.reduce(0) { $0 + $1.count }
        let t = total == 0 ? 1 : total
        return Dictionary(list.map { ($0.word, $0.count / t) }, uniquingKeysWith: { a, _ in a })
    }

    private func contextShares(_ context: [String]) -> Shares {
        guard let model = phraseModel, !context.isEmpty else { return Shares() }
        let n = model.next(after: context)
        return Shares(tri: share(n.trigrams), bi: share(n.bigrams))
    }

    /// Context counts for autocorrect tie-breaking (word -> share).
    public func contextCounts(for context: [String]) -> [String: Double] {
        let s = contextShares(context)
        var out = s.bi
        for (w, v) in s.tri { out[w] = max(out[w] ?? 0, v * 1.5) }
        return out
    }

    // MARK: Completions and next words

    private func prefixRange(_ prefix: String) -> ArraySlice<String> {
        var lo = 0
        var hi = sorted.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if sorted[mid] < prefix { lo = mid + 1 } else { hi = mid }
        }
        var end = lo
        while end < sorted.count && sorted[end].hasPrefix(prefix) { end += 1 }
        return sorted[lo..<end]
    }

    private static func fixI(_ w: String) -> String {
        w == "i" || w.hasPrefix("i'") ? "I" + w.dropFirst() : w
    }

    /// Words starting with `prefix`, ranked by frequency, personal use and context.
    public func complete(prefix: String, context: [String] = [], k: Int = 3) -> [String] {
        let p = prefix.lowercased()
        if p.isEmpty { return [] }
        let s = contextShares(context)
        var scores: [String: Double] = [:]
        func add(_ w: String) {
            if scores[w] != nil { return }
            scores[w] = logPrior(w) + 4 * (s.tri[w] ?? 0) + 2.5 * (s.bi[w] ?? 0)
        }
        for w in prefixRange(p).prefix(4000) { add(w) }
        for w in personal.keys where w.hasPrefix(p) { add(w) }
        for w in s.tri.keys where w.hasPrefix(p) { add(w) }
        for w in s.bi.keys where w.hasPrefix(p) { add(w) }
        return scores.sorted { $0.value > $1.value }.prefix(k).map { Self.fixI($0.key) }
    }

    /// Next-word suggestions after a word boundary.
    public func nextWords(context: [String] = [], k: Int = 3, sentenceStart: Bool = false) -> [String] {
        if sentenceStart && context.isEmpty { return Array(starters.prefix(k)) }
        let s = contextShares(context)
        var scores: [String: Double] = [:]
        for (w, v) in s.tri { scores[w, default: 0] += 3 * v }
        for (w, v) in s.bi { scores[w, default: 0] += 1.5 * v }
        // Tie-break with general frequency, lightly: the person's own phrase
        // counts should win over how common a word is in English (0.02 in Palate Keys)
        for (w, v) in scores { scores[w] = v + 0.005 * logPrior(w) }
        var out = scores.sorted { $0.value > $1.value }.map(\.key)
        if out.count < k {
            let fallback = sentenceStart ? starters.map { $0.lowercased() } : Array(ranked.prefix(12))
            for w in fallback where !out.contains(w) { out.append(w) }
        }
        return out.prefix(k).map(Self.fixI)
    }

    // MARK: Touch biasing

    /// Probability of each next letter after `prefix` (for touch-target biasing).
    public func nextLetterProbs(prefix: String) -> [Character: Double] {
        let p = prefix.lowercased()
        if let cached = letterCache[p] { return cached }
        var weights: [Character: Double] = [:]
        var total = 0.0
        func add(_ w: String, _ weight: Double) {
            guard w.count > p.count else { return }
            let ch = w[w.index(w.startIndex, offsetBy: p.count)]
            weights[ch, default: 0] += weight
            total += weight
        }
        for w in prefixRange(p) { add(w, 1 / (Double(rankOf[w] ?? 0) + 30)) }
        for (w, c) in personal where w.hasPrefix(p) { add(w, 0.02 * log(1 + c)) }
        var probs: [Character: Double] = [:]
        if total > 0 { for (ch, wt) in weights { probs[ch] = wt / total } }
        if letterCache.count > 500 { letterCache.removeAll() }
        letterCache[p] = probs
        return probs
    }
}
