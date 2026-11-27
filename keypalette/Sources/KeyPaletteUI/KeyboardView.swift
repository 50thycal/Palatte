#if canImport(UIKit)
import UIKit
import KeyPaletteCore

/// The Key Palette keyboard: a hotkey row (per profile), a suggestion bar with
/// the profile chip, and the typing layers with swipe-up alternates. Used by
/// the keyboard extension and by the app's playground.
public final class KeyboardView: UIInputView, UIInputViewAudioFeedback {
    public weak var host: KeyboardHost? {
        didSet { refresh() }
    }

    public let brain: Brain
    public private(set) var profiles: [Profile]
    public private(set) var activeProfileIndex: Int

    /// Called when the person switches profile with the chip.
    public var onProfileChanged: ((Profile) -> Void)?

    public var enableInputClicksWhenVisible: Bool { true }

    private enum Shift { case off, once, lock }

    private var currentLayer: LayerName = .letters
    private var shift: Shift = .off
    private var lastShiftTap = Date.distantPast

    private let bar = UIView()
    private let chip = UIButton(type: .system)
    private var suggestionButtons: [UIButton] = []
    private var suggestions: [Suggestion] = []
    private var hotkeyViews: [KeyView] = []
    private var rowViews: [[KeyView]] = []
    private var rowDefs: [[KeyDef]] = []

    // MARK: Sizing

    /// The height the keyboard wants, for the host to constrain itself to.
    public static func preferredHeight(compact: Bool, hasHotkeys: Bool) -> CGFloat {
        let m = metrics(compact: compact)
        let hot = hasHotkeys ? m.hotH + m.gap : 0
        return m.top + m.barH + m.gap + hot + 4 * m.rowH + 3 * m.gap + m.bottom
    }

    private struct Metrics {
        let top: CGFloat, barH: CGFloat, hotH: CGFloat, rowH: CGFloat, gap: CGFloat, bottom: CGFloat
    }

    private static func metrics(compact: Bool) -> Metrics {
        compact
            ? Metrics(top: 2, barH: 30, hotH: 28, rowH: 34, gap: 4, bottom: 3)
            : Metrics(top: 3, barH: 40, hotH: 36, rowH: 44, gap: 8, bottom: 4)
    }

    private var isCompact: Bool { traitCollection.verticalSizeClass == .compact }

    // MARK: Setup

    public init(brain: Brain, profiles: [Profile], activeProfileID: String?) {
        let list = profiles.isEmpty ? [Profile.plain] : profiles
        let index = list.firstIndex { $0.id == activeProfileID } ?? 0
        self.brain = brain
        self.profiles = list
        self.activeProfileIndex = index
        super.init(frame: .zero, inputViewStyle: .keyboard)
        allowsSelfSizing = true
        backgroundColor = Theme.background
        brain.activate(list[index])

        addSubview(bar)
        chip.titleLabel?.font = .systemFont(ofSize: 18)
        chip.addTarget(self, action: #selector(cycleProfile), for: .touchUpInside)
        chip.accessibilityLabel = "Profile"
        bar.addSubview(chip)
        for i in 0..<3 {
            let b = UIButton(type: .system)
            b.titleLabel?.font = .systemFont(ofSize: 16)
            b.titleLabel?.lineBreakMode = .byTruncatingTail
            b.setTitleColor(Theme.text, for: .normal)
            b.tag = i
            b.addTarget(self, action: #selector(tapSuggestion(_:)), for: .touchUpInside)
            bar.addSubview(b)
            suggestionButtons.append(b)
        }
        rebuild()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public var activeProfile: Profile { profiles[activeProfileIndex] }

    public func setProfiles(_ list: [Profile], activeID: String?) {
        profiles = list.isEmpty ? [.plain] : list
        activeProfileIndex = profiles.firstIndex { $0.id == activeID } ?? 0
        brain.activate(profiles[activeProfileIndex])
        rebuild()
        refresh()
    }

    public var hasHotkeys: Bool { !activeProfile.hotkeys.isEmpty }

    // MARK: Building the keys

    private func rebuild() {
        (hotkeyViews + rowViews.flatMap { $0 }).forEach { $0.removeFromSuperview() }
        hotkeyViews = []
        rowViews = []

        let accent = Theme.color(hex: activeProfile.colorHex, fallback: .systemBlue)
        chip.setTitle(activeProfile.icon, for: .normal)

        if currentLayer == .letters {
            for hk in activeProfile.hotkeys {
                let k = makeHotkey(hk, accent: accent)
                addSubview(k)
                hotkeyViews.append(k)
            }
        }

        var defs = Layouts.rows(currentLayer)
        if host?.showsGlobeKey ?? true {
            // iOS asks every keyboard to offer a way to switch to the next one
            defs[3].insert(KeyDef(action: .globe, label: "🌐"), at: 1)
        }
        rowDefs = defs
        for row in defs {
            var views: [KeyView] = []
            for def in row {
                let k = makeKey(def)
                addSubview(k)
                views.append(k)
            }
            rowViews.append(views)
        }
        setNeedsLayout()
    }

    private func makeKey(_ def: KeyDef) -> KeyView {
        let k = KeyView()
        if let action = def.action {
            switch action {
            case .shift:
                let glyph = shift == .lock ? "⇪" : (shift == .once ? "⬆︎" : "⇧")
                k.configure(text: glyph, style: .action, accessibilityLabel: "Shift")
                k.onTap = { [weak self] in self?.tapShift() }
            case .backspace:
                k.configure(text: "⌫", style: .action, accessibilityLabel: "Delete")
                k.onPress = { [weak self] in self?.backspace() }
                k.onRepeat = { [weak self] in self?.backspace() }
            case .space:
                k.configure(text: "space", style: .letter, fontSize: 16)
                k.onTap = { [weak self] in self?.space() }
                k.onTrackpad = { [weak self] steps in self?.host?.moveCursor(by: steps) }
            case .enter:
                k.configure(text: "return", style: .action, fontSize: 16)
                k.onTap = { [weak self] in self?.returnKey() }
            case .layer:
                k.configure(text: def.label ?? "", style: .action, fontSize: 16)
                k.onTap = { [weak self] in
                    guard let self, let l = def.layer else { return }
                    self.currentLayer = l
                    self.rebuild()
                }
            case .globe:
                k.configure(text: def.label ?? "🌐", style: .action, fontSize: 18, accessibilityLabel: "Next keyboard")
                k.onTap = { [weak self] in self?.host?.switchKeyboard() }
            case .profile:
                break
            }
        } else if let ch = def.char {
            let letters = currentLayer == .letters
            let shown = letters && shift != .off ? ch.uppercased() : ch
            k.configure(text: shown, alt: letters ? def.alt : nil, style: .letter)
            k.onTap = { [weak self] in self?.typeCharacter(shown) }
            if let alt = def.alt, letters { k.onAlt = { [weak self] in self?.typeCharacter(alt) } }
        }
        let press = k.onPress
        k.onPress = {
            UIDevice.current.playInputClick()
            press?()
        }
        return k
    }

    private func makeHotkey(_ hk: Hotkey, accent: UIColor) -> KeyView {
        let k = KeyView()
        let style: KeyView.Style = hk.plain == true ? .plain : .hot
        k.configure(text: hk.label, alt: hk.alt?.label, style: style, accent: accent, fontSize: 15,
                    hasHold: hk.hold != nil, accessibilityLabel: hk.title ?? hk.label)
        k.onPress = { UIDevice.current.playInputClick() }
        k.onTap = { [weak self] in
            if let layer = hk.layer.flatMap(LayerName.init(rawValue:)) {
                self?.currentLayer = layer
                self?.rebuild()
            } else {
                self?.run(insert: hk.insert, action: hk.action)
            }
        }
        if let alt = hk.alt { k.onAlt = { [weak self] in self?.run(insert: alt.insert, action: alt.action) } }
        if let hold = hk.hold { k.onHold = { [weak self] in self?.run(insert: hold.insert, action: hold.action) } }
        return k
    }

    // MARK: Layout

    public override func layoutSubviews() {
        super.layoutSubviews()
        let m = Self.metrics(compact: isCompact)
        let left = max(3, safeAreaInsets.left)
        let right = max(3, safeAreaInsets.right)
        let width = bounds.width - left - right
        var y = m.top

        bar.frame = CGRect(x: left, y: y, width: width, height: m.barH)
        chip.frame = CGRect(x: 0, y: 0, width: 40, height: m.barH)
        let sw = (width - 44) / 3
        for (i, b) in suggestionButtons.enumerated() {
            b.frame = CGRect(x: 44 + CGFloat(i) * sw, y: 0, width: sw, height: m.barH)
        }
        y += m.barH + m.gap

        if !hotkeyViews.isEmpty {
            layoutRow(hotkeyViews, widths: hotkeyViews.map { _ in 1 }, y: y, height: m.hotH, left: left, width: width, gap: m.gap - 1)
            y += m.hotH + m.gap
        }
        for (r, views) in rowViews.enumerated() {
            let inset = currentLayer == .letters && r == 1 ? width * 0.05 : 0
            layoutRow(views, widths: rowDefs[r].map { $0.width }, y: y, height: m.rowH, left: left + inset, width: width - 2 * inset, gap: m.gap - 2)
            y += m.rowH + m.gap
        }
    }

    private func layoutRow(_ views: [KeyView], widths: [Double], y: CGFloat, height: CGFloat, left: CGFloat, width: CGFloat, gap: CGFloat) {
        guard !views.isEmpty else { return }
        let gaps = gap * CGFloat(views.count - 1)
        let total = widths.reduce(0, +)
        let unit = (width - gaps) / CGFloat(total)
        var x = left
        for (k, w) in zip(views, widths) {
            let kw = unit * CGFloat(w)
            k.frame = CGRect(x: x, y: y, width: kw, height: height)
            x += kw + gap
        }
    }

    // MARK: Typing

    private var before: String { host?.contextBefore ?? "" }

    private func typeCharacter(_ ch: String) {
        guard let host else { return }
        host.perform(brain.session.character(ch, before: host.contextBefore))
        if shift == .once { shift = .off }
        afterEdit()
    }

    private func space() {
        guard let host else { return }
        host.perform(brain.session.space(before: host.contextBefore))
        if currentLayer != .letters {
            currentLayer = .letters
            rebuild()
        }
        afterEdit()
    }

    private func returnKey() {
        guard let host else { return }
        host.perform(brain.session.returnKey(before: host.contextBefore))
        afterEdit()
    }

    private func backspace() {
        guard let host else { return }
        let edit = brain.session.backspace(before: host.contextBefore)
        host.perform(edit)
        if let w = edit.learned { host.didLearn(w) }
        afterEdit()
    }

    private func run(insert: String?, action: String?) {
        guard let host else { return }
        if let action {
            host.perform(brain.run(action: action, before: host.contextBefore))
        } else if let insert {
            let x = Template.expand(insert)
            host.perform(Edit(insert: x.text, cursorBack: x.cursorBack))
        }
        brain.session.noteExternalInsert()
        afterEdit()
    }

    private func tapShift() {
        let now = Date()
        if now.timeIntervalSince(lastShiftTap) < 0.32 {
            shift = .lock
        } else {
            shift = shift == .off ? .once : .off
        }
        lastShiftTap = now
        rebuild()
    }

    private func afterEdit() {
        updateAutoShift()
        refreshSuggestions()
    }

    private func updateAutoShift() {
        guard shift != .lock else { return }
        let want: Shift = brain.session.shouldCapitalize(before: before) ? .once : .off
        if want != shift {
            shift = want
            if currentLayer == .letters { rebuild() }
        } else if currentLayer == .letters && shift == .off {
            // labels are already lowercase
        }
    }

    // MARK: Suggestions and profile

    /// The text field changed under us (a selection moved, another app typed): re-read it.
    public func refresh() {
        updateAutoShift()
        refreshSuggestions()
    }

    private func refreshSuggestions() {
        suggestions = brain.session.suggestions(before: before)
        for (i, b) in suggestionButtons.enumerated() {
            if i < suggestions.count {
                let s = suggestions[i]
                b.setTitle(s.label, for: .normal)
                b.titleLabel?.font = s.primary ? .systemFont(ofSize: 16, weight: .semibold) : .systemFont(ofSize: 16)
                b.isHidden = false
            } else {
                b.setTitle("", for: .normal)
                b.isHidden = true
            }
        }
    }

    @objc private func tapSuggestion(_ sender: UIButton) {
        guard let host, sender.tag < suggestions.count else { return }
        UIDevice.current.playInputClick()
        let s = suggestions[sender.tag]
        let edit = brain.session.accept(s, before: host.contextBefore, after: host.contextAfter)
        host.perform(edit)
        if let w = edit.learned { host.didLearn(w) }
        afterEdit()
    }

    @objc private func cycleProfile() {
        guard profiles.count > 1 else { return }
        activeProfileIndex = (activeProfileIndex + 1) % profiles.count
        brain.activate(profiles[activeProfileIndex])
        rebuild()
        refresh()
        onProfileChanged?(profiles[activeProfileIndex])
    }
}
#endif
