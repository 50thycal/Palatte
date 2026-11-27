import Foundation

/// A trigger ("omw", ";d") that expands to longer text when followed by a
/// space, punctuation or return. Expansions can hold {date} {time} {day} {iso}
/// and a {cursor} marker.
public struct ShortcutEntry: Codable, Equatable, Sendable {
    public var trigger: String
    public var expansion: String
    public init(trigger: String, expansion: String) {
        self.trigger = trigger
        self.expansion = expansion
    }
}

/// Text ready to insert, and where the caret should end up.
public struct ExpandedText: Equatable, Sendable {
    public var text: String
    /// Characters from the end of `text` back to the {cursor} marker (0 if none).
    public var cursorBack: Int
    public init(text: String, cursorBack: Int = 0) {
        self.text = text
        self.cursorBack = cursorBack
    }
}

public enum Template {
    private static func format(_ pattern: String, _ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = pattern
        return f.string(from: date)
    }

    /// Fill {date} {time} {day} {iso} and find the {cursor} marker.
    public static func expand(_ template: String, now: Date = Date()) -> ExpandedText {
        var s = template
        s = s.replacingOccurrences(of: "{date}", with: format("MMMM d, yyyy", now))
        s = s.replacingOccurrences(of: "{time}", with: format("h:mm a", now))
        s = s.replacingOccurrences(of: "{day}", with: format("EEEE", now))
        s = s.replacingOccurrences(of: "{iso}", with: format("yyyy-MM-dd", now))
        guard let r = s.range(of: "{cursor}") else { return ExpandedText(text: s) }
        let back = s[r.upperBound...].count
        s.removeSubrange(r)
        return ExpandedText(text: s, cursorBack: back)
    }
}

public struct ShortcutTable {
    private var map: [String: String] = [:]

    public static let defaults = [
        ShortcutEntry(trigger: ";d", expansion: "{date}"),
        ShortcutEntry(trigger: ";t", expansion: "{time}"),
    ]

    public init(_ list: [ShortcutEntry] = ShortcutTable.defaults) {
        for e in list {
            let t = e.trigger.trimmingCharacters(in: .whitespaces)
            if t.count >= 2 && !t.contains(where: \.isWhitespace) && !e.expansion.isEmpty {
                map[t.lowercased()] = e.expansion
            }
        }
    }

    /// The expansion for a token typed just before the caret, or nil.
    public func expansion(for token: String, now: Date = Date()) -> ExpandedText? {
        guard let t = map[token.lowercased()] else { return nil }
        return Template.expand(t, now: now)
    }

    public static func validate(_ e: ShortcutEntry) -> String? {
        let t = e.trigger.trimmingCharacters(in: .whitespaces)
        if t.count < 2 { return "Use at least 2 characters for the shortcut" }
        if t.contains(where: \.isWhitespace) { return "Shortcuts can't contain spaces" }
        if e.expansion.trimmingCharacters(in: .whitespaces).isEmpty { return "Add the text it should expand to" }
        return nil
    }
}
