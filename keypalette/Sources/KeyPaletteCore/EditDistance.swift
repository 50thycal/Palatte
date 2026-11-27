import Foundation

/// Keyboard-aware Damerau-Levenshtein (optimal string alignment), ported from
/// Palate Keys. typed -> target. Substitutions between neighbouring keys are
/// cheap, a doubled key or a skipped vowel is a small slip, a swap costs 0.5.
/// Bails out early once every path exceeds `max`.
enum EditDistance {
    /// Substitution costs by byte pair (ASCII only; everything else costs 1).
    static let sub: [Double] = {
        var t = [Double](repeating: 1, count: 128 * 128)
        for a in 0..<128 { t[a * 128 + a] = 0 }
        let vowels = Array("aeiou".utf8)
        for a in vowels { for b in vowels where a != b { t[Int(a) * 128 + Int(b)] = 0.8 } }
        for (a, set) in Layouts.neighbours {
            guard let ab = a.asciiValue else { continue }
            for b in set { if let bb = b.asciiValue { t[Int(ab) * 128 + Int(bb)] = 0.55 } }
        }
        return t
    }()

    private static let neighbourTable: [Bool] = {
        var t = [Bool](repeating: false, count: 128 * 128)
        for (a, set) in Layouts.neighbours {
            guard let ab = a.asciiValue else { continue }
            for b in set { if let bb = b.asciiValue { t[Int(ab) * 128 + Int(bb)] = true } }
        }
        return t
    }()

    @inline(__always) private static func clamp(_ b: UInt8) -> Int { min(127, Int(b)) }

    private static func isNeighbour(_ a: UInt8, _ b: UInt8) -> Bool {
        neighbourTable[clamp(a) * 128 + clamp(b)]
    }

    /// Cost of an extra typed character at index i.
    static func delCost(_ typed: [UInt8], _ i: Int) -> Double {
        let ch = typed[i]
        if i > 0 && typed[i - 1] == ch { return 0.4 }            // doubled key
        let prev: UInt8? = i > 0 ? typed[i - 1] : nil
        let next: UInt8? = i + 1 < typed.count ? typed[i + 1] : nil
        if (prev.map { isNeighbour(ch, $0) } ?? false) || (next.map { isNeighbour(ch, $0) } ?? false) {
            return 0.6                                           // brushed a neighbour
        }
        return 1
    }

    /// Cost of a missed character at target index j.
    static func insCost(_ target: [UInt8], _ j: Int) -> Double {
        let ch = target[j]
        let m = target.count
        if j > 0 && target[j - 1] == ch { return 0.45 }          // missed a double letter
        if ch == UInt8(ascii: "'") { return 0.3 }                // missing apostrophe
        if ch == UInt8(ascii: "g") && j == m - 1 && endsWith(target, "ing") { return 0.3 } // "lookin"
        if ch == UInt8(ascii: "e") && j == m - 2 && endsWith(target, "ed") { return 0.5 }  // "happend"
        if "aeiou".utf8.contains(ch) { return 0.75 }             // skipped vowel
        return 1
    }

    private static func endsWith(_ bytes: [UInt8], _ suffix: String) -> Bool {
        let s = Array(suffix.utf8)
        return bytes.count >= s.count && Array(bytes[(bytes.count - s.count)...]) == s
    }

    /// The typed word with its per-character costs computed once, so scoring
    /// thousands of candidates against it stays cheap.
    struct Typed {
        let bytes: [UInt8]
        let del: [Double]
        init(_ word: String) {
            let b = Array(word.utf8)
            bytes = b
            del = (0..<b.count).map { EditDistance.delCost(b, $0) }
        }
    }

    /// Reusable work arrays, so scoring thousands of candidates allocates nothing.
    final class Scratch {
        var ins = [Double](repeating: 0, count: 64)
        var a = [Double](repeating: 0, count: 65)
        var b = [Double](repeating: 0, count: 65)
        var c = [Double](repeating: 0, count: 65)
    }

    static func cost(typed: Typed, target: [UInt8], limit: Double = .infinity, scratch: Scratch = Scratch()) -> Double {
        let n = typed.bytes.count
        let m = target.count
        if abs(n - m) > 3 || n > 60 || m > 60 { return .infinity }

        for j in 0..<m { scratch.ins[j] = insCost(target, j) }

        // Three rolling rows: two back, one back, current
        var prev2 = scratch.a
        var prev = scratch.b
        var cur = scratch.c
        prev[0] = 0
        if m >= 1 { for j in 1...m { prev[j] = prev[j - 1] + scratch.ins[j - 1] } }
        if n == 0 { return prev[m] }

        for i in 1...n {
            let del = typed.del[i - 1]
            let t = clamp(typed.bytes[i - 1])
            let tRow = t * 128
            cur[0] = prev[0] + del
            var rowMin = cur[0]
            if m >= 1 {
                for j in 1...m {
                    let g = clamp(target[j - 1])
                    var v = prev[j - 1] + sub[tRow + g]
                    let d = prev[j] + del
                    if d < v { v = d }
                    let a = cur[j - 1] + scratch.ins[j - 1]
                    if a < v { v = a }
                    if i > 1 && j > 1 && t == clamp(target[j - 2]) && clamp(typed.bytes[i - 2]) == g {
                        let x = prev2[j - 2] + 0.5
                        if x < v { v = x }
                    }
                    cur[j] = v
                    if v < rowMin { rowMin = v }
                }
            }
            if rowMin > limit { return .infinity }
            swap(&prev2, &prev)
            swap(&prev, &cur)
        }
        return prev[m]
    }

    /// Longest typo worth correcting, by word length.
    static func maxCost(forLength len: Int) -> Double {
        if len <= 2 { return 0 }
        if len == 3 { return 1 }
        if len <= 5 { return 1.3 }
        if len <= 8 { return 2 }
        return 2.5
    }
}
