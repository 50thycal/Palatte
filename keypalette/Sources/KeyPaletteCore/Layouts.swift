import Foundation

/// What a key does when it isn't a plain character.
public enum KeyAction: String, Codable, Sendable {
    case shift, backspace, space, enter, layer, globe, profile
}

public enum LayerName: String, Codable, Sendable {
    case letters, numbers, symbols
}

/// One key on the typing layers. A character key may carry a swipe-up alternate.
public struct KeyDef: Equatable, Sendable {
    public var char: String?
    public var alt: String?
    public var action: KeyAction?
    public var label: String?
    public var layer: LayerName?
    /// Width in key units (a letter is 1).
    public var width: Double

    public init(char: String? = nil, alt: String? = nil, action: KeyAction? = nil,
                label: String? = nil, layer: LayerName? = nil, width: Double = 1) {
        self.char = char
        self.alt = alt
        self.action = action
        self.label = label
        self.layer = layer
        self.width = width
    }

    public static func key(_ c: Character, alt: Character? = nil) -> KeyDef {
        KeyDef(char: String(c), alt: alt.map(String.init))
    }
}

/// The typing layers, ported from Palate Keys (layouts.js).
public enum Layouts {
    private static func letterRow(_ chars: String, _ alts: String) -> [KeyDef] {
        zip(chars, alts).map { KeyDef.key($0, alt: $1) }
    }

    private static func bottomRow(layerKey: KeyDef) -> [KeyDef] {
        [
            layerKey,
            KeyDef(char: ",", alt: "!"),
            KeyDef(action: .space, width: 4.6),
            KeyDef(char: ".", alt: "?"),
            KeyDef(action: .enter, width: 2),
        ]
    }

    public static func rows(_ layer: LayerName) -> [[KeyDef]] {
        switch layer {
        case .letters:
            return [
                letterRow("qwertyuiop", "1234567890"),
                letterRow("asdfghjkl", "@#$&*()'\""),
                [KeyDef(action: .shift, width: 1.4)] + letterRow("zxcvbnm", "%-+=/;:") + [KeyDef(action: .backspace, width: 1.4)],
                bottomRow(layerKey: KeyDef(action: .layer, label: "123", layer: .numbers, width: 1.4)),
            ]
        case .numbers:
            return [
                "1234567890".map { KeyDef.key($0) },
                "-/:;()$&@\"".map { KeyDef.key($0) },
                [KeyDef(action: .layer, label: "#+=", layer: .symbols, width: 1.4)]
                    + ".,?!'".map { KeyDef.key($0) }
                    + [KeyDef(action: .backspace, width: 1.4)],
                bottomRow(layerKey: KeyDef(action: .layer, label: "ABC", layer: .letters, width: 1.4)),
            ]
        case .symbols:
            return [
                "[]{}#%^*+=".map { KeyDef.key($0) },
                "_\\|~<>€£¥•".map { KeyDef.key($0) },
                [KeyDef(action: .layer, label: "123", layer: .numbers, width: 1.4)]
                    + ".,?!'".map { KeyDef.key($0) }
                    + [KeyDef(action: .backspace, width: 1.4)],
                bottomRow(layerKey: KeyDef(action: .layer, label: "ABC", layer: .letters, width: 1.4)),
            ]
        }
    }

    /// Long-press alternates.
    public static let accents: [String: [String]] = [
        "a": ["à", "á", "â", "ä", "æ", "ã", "å"],
        "e": ["è", "é", "ê", "ë", "ē"],
        "i": ["ì", "í", "î", "ï"],
        "o": ["ò", "ó", "ô", "ö", "õ", "ø", "œ"],
        "u": ["ù", "ú", "û", "ü"],
        "n": ["ñ"], "c": ["ç"], "s": ["ß"], "y": ["ÿ"],
        ".": ["…", "•", "·"],
        ",": [";", ":"],
        "-": ["–", "—", "_"],
        "'": ["’", "‘", "`"],
        "\"": ["“", "”", "«", "»"],
        "?": ["¿"], "!": ["¡"],
        "$": ["€", "£", "¥", "¢"],
        "/": ["\\", "|"],
        "0": ["°"],
    ]

    /// Physical neighbours on QWERTY, used by autocorrect's error model.
    public static let neighbours: [Character: Set<Character>] = {
        let rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"]
        let offsets: [Double] = [0, 0.5, 1.5]
        var pos: [Character: (Double, Double)] = [:]
        for (r, row) in rows.enumerated() {
            for (c, ch) in row.enumerated() { pos[ch] = (Double(c) + offsets[r], Double(r)) }
        }
        var map: [Character: Set<Character>] = [:]
        for (a, pa) in pos {
            var set = Set<Character>()
            for (b, pb) in pos where a != b {
                let dx = pa.0 - pb.0
                let dy = pa.1 - pb.1
                if abs(dy) <= 1 && abs(dx) <= 1.01 { set.insert(b) }
            }
            map[a] = set
        }
        return map
    }()
}
