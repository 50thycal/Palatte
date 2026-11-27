#if canImport(UIKit)
import UIKit

/// One key. It tracks its own touch, so a swipe up, a long press and a
/// space-bar drag are all decided here and reported through closures.
final class KeyView: UIView {
    enum Style { case letter, action, hot, plain }

    private enum Mode { case tap, alt, hold, trackpad, repeating }

    var onPress: (() -> Void)?
    var onTap: (() -> Void)?
    var onAlt: (() -> Void)?
    var onHold: (() -> Void)?
    /// Called with whole steps while dragging along a trackpad key (space).
    var onTrackpad: ((Int) -> Void)?
    /// Called repeatedly while held (backspace).
    var onRepeat: (() -> Void)?

    private let label = UILabel()
    private let altLabel = UILabel()
    private var style: Style = .letter
    private var accent: UIColor = .systemBlue
    private var mode: Mode = .tap
    private var start = CGPoint.zero
    private var lastX: CGFloat = 0
    private var holdTimer: Timer?
    private var repeatTimer: Timer?
    private var hasAlt = false
    private var hasHold = false

    static let swipeUp: CGFloat = 22
    static let trackpadStart: CGFloat = 10
    static let trackpadStep: CGFloat = 9

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerRadius = 6
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.3
        layer.shadowRadius = 0
        layer.shadowOffset = CGSize(width: 0, height: 1)
        isMultipleTouchEnabled = false
        label.textAlignment = .center
        label.adjustsFontSizeToFitWidth = true
        label.minimumScaleFactor = 0.5
        altLabel.textAlignment = .right
        altLabel.font = .systemFont(ofSize: 10)
        addSubview(label)
        addSubview(altLabel)
        isAccessibilityElement = true
        accessibilityTraits = .keyboardKey
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func configure(text: String, alt: String? = nil, style: Style, accent: UIColor = .systemBlue,
                   fontSize: CGFloat = 22, hasHold: Bool = false, accessibilityLabel: String? = nil) {
        self.style = style
        self.accent = accent
        self.hasAlt = alt != nil
        self.hasHold = hasHold
        label.text = text
        label.font = style == .hot ? .systemFont(ofSize: min(fontSize, 15), weight: .semibold) : .systemFont(ofSize: fontSize)
        altLabel.text = alt
        altLabel.isHidden = alt == nil
        self.accessibilityLabel = accessibilityLabel ?? text
        applyColors(pressed: false)
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let hot = style == .hot && hasAlt
        label.frame = bounds.insetBy(dx: 2, dy: 0).offsetBy(dx: 0, dy: hot ? 5 : 0)
        altLabel.frame = CGRect(x: 2, y: 2, width: bounds.width - 6, height: 12)
        altLabel.font = .systemFont(ofSize: style == .hot ? 9 : 10)
    }

    private func applyColors(pressed: Bool) {
        switch style {
        case .letter:
            backgroundColor = pressed ? Theme.keyDown : Theme.key
            label.textColor = Theme.text
            altLabel.textColor = Theme.muted
        case .action, .plain:
            backgroundColor = pressed ? Theme.key : Theme.keyAction
            label.textColor = Theme.text
            altLabel.textColor = Theme.muted
        case .hot:
            backgroundColor = pressed ? accent.withAlphaComponent(0.75) : accent
            label.textColor = .white
            altLabel.textColor = UIColor.white.withAlphaComponent(0.75)
        }
    }

    // MARK: Touches

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = touches.first else { return }
        start = t.location(in: self)
        lastX = start.x
        mode = .tap
        applyColors(pressed: true)
        onPress?()
        holdTimer?.invalidate()
        if onRepeat != nil {
            // The first tap already deleted; start repeating after a pause
            holdTimer = Timer.scheduledTimer(withTimeInterval: 0.42, repeats: false) { [weak self] _ in self?.beginRepeating() }
        } else if hasHold {
            holdTimer = Timer.scheduledTimer(withTimeInterval: 0.38, repeats: false) { [weak self] _ in self?.fireHold() }
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = touches.first else { return }
        let p = t.location(in: self)
        let dx = p.x - start.x
        let dy = p.y - start.y

        if onTrackpad != nil {
            if mode == .tap && abs(dx) > Self.trackpadStart {
                mode = .trackpad
                holdTimer?.invalidate()
                lastX = p.x
            }
            if mode == .trackpad {
                let steps = Int((p.x - lastX) / Self.trackpadStep)
                if steps != 0 {
                    onTrackpad?(steps)
                    lastX += CGFloat(steps) * Self.trackpadStep
                }
            }
            return
        }

        guard hasAlt, mode == .tap || mode == .alt else { return }
        if dy < -Self.swipeUp && abs(dy) > abs(dx) {
            if mode != .alt {
                mode = .alt
                holdTimer?.invalidate()
                altLabel.font = .systemFont(ofSize: 16, weight: .semibold)
            }
        } else if mode == .alt && dy > -Self.swipeUp / 2 {
            mode = .tap
            altLabel.font = .systemFont(ofSize: style == .hot ? 9 : 10)
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        let finished = mode
        cleanup()
        switch finished {
        case .tap: onTap?()
        case .alt: onAlt?()
        case .hold, .trackpad, .repeating: break
        }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        cleanup()
    }

    private func cleanup() {
        holdTimer?.invalidate()
        repeatTimer?.invalidate()
        holdTimer = nil
        repeatTimer = nil
        applyColors(pressed: false)
        altLabel.font = .systemFont(ofSize: style == .hot ? 9 : 10)
        mode = .tap
    }

    private func fireHold() {
        guard mode == .tap else { return }
        mode = .hold
        onHold?()
    }

    private func beginRepeating() {
        guard mode == .tap else { return }
        mode = .repeating
        repeatTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in self?.onRepeat?() }
    }
}
#endif
