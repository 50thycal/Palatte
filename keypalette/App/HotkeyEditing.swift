import SwiftUI
import KeyPaletteCore

/// A hotkey as plain text fields, so the editor can bind to it.
struct EditableHotkey: Identifiable, Equatable {
    var id = UUID()
    var label = ""
    var insert = ""
    var altLabel = ""
    var altInsert = ""
    var holdLabel = ""
    var holdInsert = ""
    var isFix = false
    var plain = false
    // Kept as they were, so editing a hotkey never drops what the form doesn't show
    var layer: String?
    var title: String?

    init() {}

    init(_ h: Hotkey) {
        label = h.label
        insert = h.insert ?? ""
        altLabel = h.alt?.label ?? ""
        altInsert = h.alt?.insert ?? ""
        holdLabel = h.hold?.label ?? ""
        holdInsert = h.hold?.insert ?? ""
        isFix = h.action == "fix"
        plain = h.plain ?? false
        layer = h.layer
        title = h.title
    }

    /// The short hint shown on a key for a swipe or hold when none was typed.
    private static func hint(_ text: String) -> String {
        let t = text.trimmingCharacters(in: .whitespaces)
        return t.count > 6 ? String(t.prefix(5)) + "…" : t
    }

    var hotkey: Hotkey {
        Hotkey(
            label: label,
            title: title,
            insert: isFix || insert.isEmpty ? nil : insert,
            action: isFix ? "fix" : nil,
            alt: isFix || altInsert.isEmpty ? nil : HotkeyAction(label: altLabel.isEmpty ? Self.hint(altInsert) : altLabel, insert: altInsert),
            hold: isFix || holdInsert.isEmpty ? nil : HotkeyAction(label: holdLabel.isEmpty ? Self.hint(holdInsert) : holdLabel, insert: holdInsert),
            layer: layer,
            plain: plain ? true : nil
        )
    }

    var summary: String {
        if isFix { return "Fixes spelling and dictation mistakes" }
        return [insert.isEmpty ? nil : insert,
                altInsert.isEmpty ? nil : "↑ \(altInsert)",
                holdInsert.isEmpty ? nil : "hold: \(holdInsert)"]
            .compactMap { $0 }.joined(separator: "  ·  ")
    }
}

struct HotkeyForm: View {
    @Binding var key: EditableHotkey

    var body: some View {
        Form {
            Section(header: Text("Key"), footer: Text("Eight keys or fewer fit across the keyboard.")) {
                TextField("Label on the key", text: $key.label)
                Toggle("Fix key: corrects the text before the cursor", isOn: $key.isFix)
                Toggle("Plain colour", isOn: $key.plain)
            }
            if !key.isFix {
                Section(header: Text("Tap"), footer: Text("Inserts this text. {cursor} puts the cursor there; {date} {time} {day} fill in.")) {
                    TextEditor(text: $key.insert).frame(minHeight: 70)
                }
                Section(header: Text("Swipe up"), footer: Text("A second phrase on the same key, for example the opposite.")) {
                    TextField("Hint on the key (optional)", text: $key.altLabel)
                    TextEditor(text: $key.altInsert).frame(minHeight: 60)
                }
                Section(header: Text("Hold")) {
                    TextField("Hint (optional)", text: $key.holdLabel)
                    TextEditor(text: $key.holdInsert).frame(minHeight: 60)
                }
            }
        }
        .navigationTitle(key.label.isEmpty ? "New hotkey" : key.label)
        .navigationBarTitleDisplayMode(.inline)
    }
}
