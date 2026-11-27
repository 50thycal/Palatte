import UIKit
import KeyPaletteCore
import KeyPaletteUI

/// The Key Palette keyboard extension: hosts the shared keyboard view and talks
/// to the text field through the system's `textDocumentProxy`.
final class KeyboardViewController: UIInputViewController, KeyboardHost {
    private var keyboard: KeyboardView?
    private var heightConstraint: NSLayoutConstraint?
    private let store = ProfileStore.shared()

    // MARK: KeyboardHost

    var contextBefore: String { textDocumentProxy.documentContextBeforeInput ?? "" }
    var contextAfter: String { textDocumentProxy.documentContextAfterInput ?? "" }
    var showsGlobeKey: Bool { needsInputModeSwitchKey }

    func perform(_ edit: Edit) {
        for _ in 0..<edit.delete { textDocumentProxy.deleteBackward() }
        if !edit.insert.isEmpty { textDocumentProxy.insertText(edit.insert) }
        if edit.cursorBack > 0 { textDocumentProxy.adjustTextPosition(byCharacterOffset: -edit.cursorBack) }
        if edit.cursorForward > 0 { textDocumentProxy.adjustTextPosition(byCharacterOffset: edit.cursorForward) }
    }

    func moveCursor(by offset: Int) {
        textDocumentProxy.adjustTextPosition(byCharacterOffset: offset)
    }

    func switchKeyboard() {
        advanceToNextInputMode()
    }

    func didLearn(_ word: String) {
        store.addLearned(word)
        keyboard?.brain.engine.learned.insert(word.lowercased())
    }

    // MARK: Life cycle

    override func viewDidLoad() {
        super.viewDidLoad()
        let profiles = loadProfiles()
        let brain = Brain(words: Self.loadWords(), profile: profiles.first ?? .plain)
        brain.engine.learned = Set(store.learnedWords())

        let kb = KeyboardView(brain: brain, profiles: profiles, activeProfileID: store.activeProfileID)
        kb.host = self
        kb.onProfileChanged = { [weak self] p in
            self?.store.activeProfileID = p.id
            self?.updateHeight()
        }
        kb.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(kb)
        NSLayoutConstraint.activate([
            kb.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            kb.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            kb.topAnchor.constraint(equalTo: view.topAnchor),
            kb.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        keyboard = kb
        updateHeight()
    }

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        updateHeight()
    }

    override func textDidChange(_ textInput: UITextInput?) {
        keyboard?.refresh()
    }

    override func selectionDidChange(_ textInput: UITextInput?) {
        keyboard?.refresh()
    }

    private func updateHeight() {
        guard let keyboard else { return }
        let h = KeyboardView.preferredHeight(compact: traitCollection.verticalSizeClass == .compact, hasHotkeys: keyboard.hasHotkeys)
        if let c = heightConstraint {
            c.constant = h
        } else {
            let c = view.heightAnchor.constraint(equalToConstant: h)
            c.priority = UILayoutPriority(rawValue: 999)
            c.isActive = true
            heightConstraint = c
        }
    }

    // MARK: Data

    private func loadProfiles() -> [Profile] {
        var list = store.profiles()
        if list.isEmpty, let dir = Bundle.main.url(forResource: "profiles", withExtension: nil, subdirectory: "Resources") {
            // No shared container yet (an unsigned build, or the app hasn't run): use what's bundled
            list = ProfileStore.profiles(in: dir)
        }
        return [.plain] + list
    }

    private static func loadWords() -> [String] {
        guard let url = Bundle.main.url(forResource: "words-en", withExtension: "txt", subdirectory: "Resources"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        return text.split(separator: "\n").map(String.init)
    }
}
