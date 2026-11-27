import SwiftUI
import UniformTypeIdentifiers
import KeyPaletteCore

/// Make a profile from your own writing: paste notes, messages or a draft (or
/// pick a text file) and Key Palette learns the words and phrases you use.
struct BuildProfileView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var icon = "✍️"
    @State private var text = ""
    @State private var importing = false
    @State private var error: String?

    private var wordCount: Int { text.split { $0.isWhitespace }.count }

    var body: some View {
        NavigationStack {
            Form {
                Section("Profile") {
                    TextField("Name (for example: My novel)", text: $name)
                    TextField("Icon (an emoji)", text: $icon)
                }
                Section(header: Text("Your writing"),
                        footer: Text("Paste anything you've written on this subject. The more the better; a few hundred words is a start. It's read on this phone and never leaves it. \(wordCount) words.")) {
                    TextEditor(text: $text).frame(minHeight: 220)
                    Button("Add from a text file…", systemImage: "doc.text") { importing = true }
                }
                Section(footer: Text("Key Palette keeps the words you use often (and names), the phrases you write twice or more, and how you open sentences. Edit the result afterwards.")) {
                    Button("Build profile") { build() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || wordCount < 20)
                }
            }
            .navigationTitle("From my writing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.plainText, .text]) { result in
                guard case .success(let url) = result else { return }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                if let s = try? String(contentsOf: url, encoding: .utf8) {
                    text += (text.isEmpty ? "" : "\n\n") + s
                } else {
                    error = "Couldn't read that file as text."
                }
            }
            .alert("Couldn't add that", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(error ?? "") }
        }
    }

    private func build() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        let slug = trimmed.lowercased().map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined()
        let id = "\(slug)-\(Int(Date().timeIntervalSince1970))"
        let profile = ProfileBuilder(engine: model.engine).build(id: id, name: trimmed, icon: icon.isEmpty ? "✍️" : icon, from: [text])
        model.save(profile)
        dismiss()
    }
}
