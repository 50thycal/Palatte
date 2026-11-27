import SwiftUI
import KeyPaletteCore

@main
struct KeyPaletteApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model)
        }
    }
}

/// The app's data: profiles in the shared store, and the English word list.
final class AppModel: ObservableObject {
    @Published var profiles: [Profile] = []
    let store = ProfileStore.shared()
    let words: [String]

    init() {
        if let url = Bundle.main.url(forResource: "words-en", withExtension: "txt", subdirectory: "Resources"),
           let text = try? String(contentsOf: url, encoding: .utf8) {
            words = text.split(separator: "\n").map(String.init)
        } else {
            words = []
        }
        // The profiles that ship with the app, never over what you've edited
        if let dir = Bundle.main.url(forResource: "profiles", withExtension: nil, subdirectory: "Resources") {
            store.installMissing(from: dir)
        }
        reload()
    }

    func reload() {
        profiles = store.profiles()
    }

    func save(_ profile: Profile) {
        try? store.save(profile)
        reload()
    }

    func delete(_ profile: Profile) {
        store.delete(id: profile.id)
        reload()
    }

    func importProfile(from url: URL) -> String? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            var p = try Profile.decode(Data(contentsOf: url))
            if profiles.contains(where: { $0.id == p.id }) { p.id += "-\(Int(Date().timeIntervalSince1970))" }
            save(p)
            return nil
        } catch ProfileError.newerSchema {
            return "That profile is from a newer version of Key Palette."
        } catch {
            return "That file isn't a Key Palette profile."
        }
    }
}
