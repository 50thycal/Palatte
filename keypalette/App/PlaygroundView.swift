import SwiftUI
import UIKit
import KeyPaletteCore
import KeyPaletteUI

/// Try the keyboard inside the app, without enabling it in Settings: the same
/// keyboard view, attached to a text view.
struct PlaygroundView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        NavigationStack {
            PlaygroundTextView(model: model)
                .padding(.horizontal, 8)
                .navigationTitle("Try it")
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct PlaygroundTextView: UIViewRepresentable {
    let model: AppModel

    func makeCoordinator() -> Host { Host() }

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.font = .preferredFont(forTextStyle: .title3)
        tv.text = ""
        tv.autocorrectionType = .no
        tv.autocapitalizationType = .none
        tv.smartQuotesType = .no
        tv.smartDashesType = .no
        tv.spellCheckingType = .no
        let profiles = [Profile.plain] + model.profiles
        let brain = Brain(words: model.words)
        let kb = KeyboardView(brain: brain, profiles: profiles, activeProfileID: model.store.activeProfileID)
        kb.onProfileChanged = { [model] p in model.store.activeProfileID = p.id }
        context.coordinator.textView = tv
        kb.host = context.coordinator
        kb.frame = CGRect(x: 0, y: 0, width: 0, height: KeyboardView.preferredHeight(compact: false, hasHotkeys: kb.hasHotkeys))
        tv.inputView = kb
        context.coordinator.keyboard = kb
        tv.delegate = context.coordinator
        DispatchQueue.main.async { tv.becomeFirstResponder() }
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        let profiles = [Profile.plain] + model.profiles
        context.coordinator.keyboard?.setProfiles(profiles, activeID: model.store.activeProfileID)
    }

    /// Lets the keyboard edit a UITextView the way it edits a text field through the proxy.
    final class Host: NSObject, KeyboardHost, UITextViewDelegate {
        weak var textView: UITextView?
        weak var keyboard: KeyboardView?

        var showsGlobeKey: Bool { false }

        var contextBefore: String {
            guard let tv = textView, let sel = tv.selectedTextRange,
                  let r = tv.textRange(from: tv.beginningOfDocument, to: sel.start),
                  let s = tv.text(in: r) else { return "" }
            return String(s.suffix(400))
        }

        var contextAfter: String {
            guard let tv = textView, let sel = tv.selectedTextRange,
                  let r = tv.textRange(from: sel.end, to: tv.endOfDocument),
                  let s = tv.text(in: r) else { return "" }
            return String(s.prefix(100))
        }

        func perform(_ edit: Edit) {
            guard let tv = textView else { return }
            for _ in 0..<edit.delete { tv.deleteBackward() }
            if !edit.insert.isEmpty { tv.insertText(edit.insert) }
            if edit.cursorBack > 0 { moveCursor(by: -edit.cursorBack) }
            if edit.cursorForward > 0 { moveCursor(by: edit.cursorForward) }
        }

        func moveCursor(by offset: Int) {
            guard let tv = textView, let sel = tv.selectedTextRange,
                  let p = tv.position(from: sel.start, offset: offset) else { return }
            tv.selectedTextRange = tv.textRange(from: p, to: p)
        }

        func switchKeyboard() {}

        func textViewDidChangeSelection(_ textView: UITextView) {
            keyboard?.refresh()
        }
    }
}
