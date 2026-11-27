#if canImport(UIKit)
import UIKit

/// Light and dark colours for the keyboard.
enum Theme {
    static func dynamic(light: UInt32, dark: UInt32) -> UIColor {
        UIColor { trait in
            let v = trait.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                           blue: CGFloat(v & 0xFF) / 255, alpha: 1)
        }
    }

    static let background = dynamic(light: 0xD3D5DB, dark: 0x222224)
    static let key = dynamic(light: 0xFFFFFF, dark: 0x5D5D61)
    static let keyAction = dynamic(light: 0xACB1BB, dark: 0x3B3B3E)
    static let keyDown = dynamic(light: 0xC4C7CE, dark: 0x7A7A7F)
    static let text = dynamic(light: 0x111111, dark: 0xFFFFFF)
    static let muted = dynamic(light: 0x6B6F78, dark: 0xA0A0A6)

    static func color(hex: String, fallback: UIColor) -> UIColor {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return fallback }
        return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                       blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
}
#endif
