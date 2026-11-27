import SwiftUI
import UniformTypeIdentifiers
import KeyPaletteCore

struct ProfilesView: View {
    @EnvironmentObject var model: AppModel
    @State private var importing = false
    @State private var importError: String?
    @State private var adding = false
    @State private var building = false

    var body: some View {
        NavigationStack {
            List {
                Section(footer: Text("Pick what you're working on from the 🎨 chip on the keyboard. A profile sets the words Key Palette favours and never corrects, the phrases it suggests, and the hotkey row.")) {
                    ForEach(model.profiles) { p in
                        NavigationLink(destination: ProfileEditor(profile: p)) {
                            HStack {
                                Text(p.icon).font(.title2)
                                VStack(alignment: .leading) {
                                    Text(p.name).font(.headline)
                                    Text("\(p.words.count) words · \(p.hotkeys.count) hotkeys · \(p.shortcuts.count) shortcuts")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    .onDelete { offsets in offsets.map { model.profiles[$0] }.forEach(model.delete) }
                }
            }
            .navigationTitle("Profiles")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button("From my writing…", systemImage: "text.badge.plus") { building = true }
                        Button("New profile", systemImage: "plus") { adding = true }
                        Button("Import from file…", systemImage: "square.and.arrow.down") { importing = true }
                    } label: { Image(systemName: "plus") }
                }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
                if case .success(let url) = result { importError = model.importProfile(from: url) }
            }
            .alert("Couldn't import", isPresented: Binding(get: { importError != nil }, set: { if !$0 { importError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(importError ?? "") }
            .sheet(isPresented: $building) {
                BuildProfileView()
            }
            .sheet(isPresented: $adding) {
                NavigationStack {
                    ProfileEditor(profile: Profile(id: "profile-\(Int(Date().timeIntervalSince1970))", name: "New profile"), isNew: true)
                }
            }
        }
    }
}

/// Edit a profile: its name, words, text shortcuts and hotkeys. (The phrase model
/// comes from "From my writing"; the file format is in docs/DESIGN.md.)
struct ProfileEditor: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State var profile: Profile
    var isNew = false
    @State private var wordsText = ""
    @State private var shortcutsText = ""
    @State private var hotkeys: [EditableHotkey] = []

    var body: some View {
        Form {
            Section("Profile") {
                TextField("Name", text: $profile.name)
                TextField("Icon (an emoji)", text: $profile.icon)
            }
            Section(header: Text("Words"), footer: Text("One per line. Add a number for how much you use it: railgun 3. Words here are never autocorrected, and are suggested as you type.")) {
                TextEditor(text: $wordsText).frame(minHeight: 160).font(.body.monospaced())
            }
            Section(header: Text("Text shortcuts"), footer: Text("One per line: trigger = text. Type the trigger and a space to expand it. {date} {time} {cursor} work.")) {
                TextEditor(text: $shortcutsText).frame(minHeight: 100).font(.body.monospaced())
            }
            Section(header: Text("Hotkeys"), footer: Text("The row of your own keys above the letters. Tap a key to edit it; swipe a row to delete; drag to reorder.")) {
                ForEach($hotkeys) { $key in
                    NavigationLink(destination: HotkeyForm(key: $key)) {
                        VStack(alignment: .leading) {
                            Text(key.label.isEmpty ? "(no label)" : key.label).font(.headline)
                            if !key.summary.isEmpty {
                                Text(key.summary).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                    }
                }
                .onDelete { hotkeys.remove(atOffsets: $0) }
                .onMove { hotkeys.move(fromOffsets: $0, toOffset: $1) }
                Button("Add a hotkey", systemImage: "plus") { hotkeys.append(EditableHotkey()) }
            }
        }
        .navigationTitle(isNew ? "New profile" : profile.name)
        .onAppear {
            wordsText = profile.words.sorted { $0.key < $1.key }
                .map { $0.value == 3 ? $0.key : "\($0.key) \(Int($0.value))" }.joined(separator: "\n")
            shortcutsText = profile.shortcuts.map { "\($0.trigger) = \($0.expansion)" }.joined(separator: "\n")
            hotkeys = profile.hotkeys.map(EditableHotkey.init)
        }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }
            }
            ToolbarItem(placement: .navigationBarLeading) { EditButton() }
            if isNew {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }

    private func save() {
        var p = profile
        var words: [String: Double] = [:]
        for line in wordsText.split(separator: "\n") {
            let parts = line.split(separator: " ").map(String.init)
            guard let w = parts.first?.lowercased(), !w.isEmpty else { continue }
            words[w] = parts.count > 1 ? Double(parts[1]) ?? 3 : 3
        }
        p.words = words
        p.shortcuts = shortcutsText.split(separator: "\n").compactMap { line in
            let halves = line.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            guard halves.count == 2 else { return nil }
            let e = ShortcutEntry(trigger: halves[0], expansion: halves[1])
            return ShortcutTable.validate(e) == nil ? e : nil
        }
        p.hotkeys = hotkeys.filter { !$0.label.trimmingCharacters(in: .whitespaces).isEmpty }.map(\.hotkey)
        model.save(p)
        dismiss()
    }
}
