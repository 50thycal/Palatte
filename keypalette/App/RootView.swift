import SwiftUI

struct RootView: View {
    var body: some View {
        TabView {
            SetupView()
                .tabItem { Label("Setup", systemImage: "keyboard") }
            ProfilesView()
                .tabItem { Label("Profiles", systemImage: "paintpalette") }
            PlaygroundView()
                .tabItem { Label("Try it", systemImage: "text.cursor") }
        }
    }
}

struct SetupView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Turn it on") {
                    step(1, "Open Settings › General › Keyboard › Keyboards")
                    step(2, "Tap Add New Keyboard… and choose Key Palette")
                    step(3, "In any app, hold 🌐 (or tap it) to switch to Key Palette")
                }
                Section {
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    }
                }
                Section("Good to know") {
                    Text("Key Palette works without “Allow Full Access”: nothing you type leaves your phone.")
                    Text("It doesn't appear in password fields: iOS always uses its own keyboard there.")
                    Text("For voice dictation, tap 🌐 to switch to Apple's keyboard and use its microphone.")
                }
            }
            .navigationTitle("Key Palette")
        }
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)").font(.headline).frame(width: 24, height: 24).background(Circle().fill(Color.accentColor.opacity(0.2)))
            Text(text)
        }
    }
}
