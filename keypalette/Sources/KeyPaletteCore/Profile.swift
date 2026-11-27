import Foundation

/// A keyboard "profile": what you're working on. Switching profile swaps the
/// vocabulary the keyboard favours (and never "corrects"), the phrases it
/// suggests, the hotkey row, the text shortcuts and the fixes. A profile is a
/// plain JSON file (`keypalette-profile` schema 1) so it can be edited,
/// shared, or generated from a project's own data.

public struct PhraseFix: Codable, Equatable, Sendable {
    /// Regular expression, case-insensitive. Use $1 in `replacement` for groups.
    public var pattern: String
    public var replacement: String
    public init(pattern: String, replacement: String) {
        self.pattern = pattern
        self.replacement = replacement
    }
}

/// What a swipe-up, hold or a built-in key does.
public struct HotkeyAction: Codable, Equatable, Sendable {
    public var label: String?
    public var insert: String?
    /// A built-in: "fix" corrects the text before the caret.
    public var action: String?
    public init(label: String? = nil, insert: String? = nil, action: String? = nil) {
        self.label = label
        self.insert = insert
        self.action = action
    }
}

public struct Hotkey: Codable, Equatable, Sendable {
    public var label: String
    public var title: String?
    public var insert: String?
    public var action: String?
    public var alt: HotkeyAction?
    public var hold: HotkeyAction?
    /// Jump to a layer instead of inserting.
    public var layer: String?
    /// Draw as a plain key rather than an accent-coloured one.
    public var plain: Bool?

    public init(label: String, title: String? = nil, insert: String? = nil, action: String? = nil,
                alt: HotkeyAction? = nil, hold: HotkeyAction? = nil, layer: String? = nil, plain: Bool? = nil) {
        self.label = label
        self.title = title
        self.insert = insert
        self.action = action
        self.alt = alt
        self.hold = hold
        self.layer = layer
        self.plain = plain
    }
}

public struct Profile: Codable, Equatable, Identifiable, Sendable {
    public static let currentSchema = 1

    public var schema: Int
    public var id: String
    public var name: String
    public var icon: String
    public var colorHex: String
    /// word -> weight. Weight 2 or more means "known": never corrected, and favoured in suggestions.
    public var words: [String: Double]
    /// Words offered at the start of a sentence.
    public var starters: [String]
    public var bigrams: [String: [String: Double]]
    /// Keys are "first second".
    public var trigrams: [String: [String: Double]]
    /// Misspelling -> right spelling, applied by the Fix key.
    public var typoFixes: [String: String]
    public var phraseFixes: [PhraseFix]
    public var shortcuts: [ShortcutEntry]
    public var hotkeys: [Hotkey]

    public init(id: String, name: String, icon: String = "🎨", colorHex: String = "#3A6DF0",
                words: [String: Double] = [:], starters: [String] = [],
                bigrams: [String: [String: Double]] = [:], trigrams: [String: [String: Double]] = [:],
                typoFixes: [String: String] = [:], phraseFixes: [PhraseFix] = [],
                shortcuts: [ShortcutEntry] = [], hotkeys: [Hotkey] = []) {
        self.schema = Profile.currentSchema
        self.id = id
        self.name = name
        self.icon = icon
        self.colorHex = colorHex
        self.words = words
        self.starters = starters
        self.bigrams = bigrams
        self.trigrams = trigrams
        self.typoFixes = typoFixes
        self.phraseFixes = phraseFixes
        self.shortcuts = shortcuts
        self.hotkeys = hotkeys
    }

    // Every field but id and name is optional in the file.
    private enum CodingKeys: String, CodingKey {
        case schema, id, name, icon, colorHex, words, starters, bigrams, trigrams, typoFixes, phraseFixes, shortcuts, hotkeys
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema = try c.decodeIfPresent(Int.self, forKey: .schema) ?? Profile.currentSchema
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        icon = try c.decodeIfPresent(String.self, forKey: .icon) ?? "🎨"
        colorHex = try c.decodeIfPresent(String.self, forKey: .colorHex) ?? "#3A6DF0"
        words = try c.decodeIfPresent([String: Double].self, forKey: .words) ?? [:]
        starters = try c.decodeIfPresent([String].self, forKey: .starters) ?? []
        bigrams = try c.decodeIfPresent([String: [String: Double]].self, forKey: .bigrams) ?? [:]
        trigrams = try c.decodeIfPresent([String: [String: Double]].self, forKey: .trigrams) ?? [:]
        typoFixes = try c.decodeIfPresent([String: String].self, forKey: .typoFixes) ?? [:]
        phraseFixes = try c.decodeIfPresent([PhraseFix].self, forKey: .phraseFixes) ?? []
        shortcuts = try c.decodeIfPresent([ShortcutEntry].self, forKey: .shortcuts) ?? []
        hotkeys = try c.decodeIfPresent([Hotkey].self, forKey: .hotkeys) ?? []
    }

    public static func decode(_ data: Data) throws -> Profile {
        let p = try JSONDecoder().decode(Profile.self, from: data)
        guard p.schema <= currentSchema else { throw ProfileError.newerSchema(p.schema) }
        return p
    }

    public func encoded() throws -> Data {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try e.encode(self)
    }

    /// The profile with nothing in it: plain typing.
    public static let plain = Profile(id: "plain", name: "Plain", icon: "⌨️")
}

public enum ProfileError: Error, Equatable {
    case newerSchema(Int)
}

/// A profile's phrase statistics as the engine's context source.
public struct ProfilePhraseModel: PhraseModel {
    let profile: Profile
    public init(_ profile: Profile) { self.profile = profile }

    private func list(_ d: [String: Double]?) -> [WeightedWord] {
        (d ?? [:]).map { WeightedWord(word: $0.key, count: $0.value) }
    }

    public func next(after context: [String]) -> (bigrams: [WeightedWord], trigrams: [WeightedWord]) {
        guard let last = context.last else { return ([], []) }
        let bi = list(profile.bigrams[last])
        let tri = context.count >= 2 ? list(profile.trigrams["\(context[context.count - 2]) \(last)"]) : []
        return (bi, tri)
    }
}
