import Foundation

/// Where profiles live and which one is active. The app writes them; the
/// keyboard extension reads them, through the App Group container they share.
/// Without a container (an unsigned build) it falls back to the process's own
/// folder, and the extension falls back to the profiles bundled in its resources.
public final class ProfileStore {
    public static let appGroup = "group.com.appfarm.keypalette"

    public let directory: URL
    private let defaults: UserDefaults
    private let fm = FileManager.default

    private static let activeKey = "activeProfile"
    private static let learnedKey = "learnedWords"
    private static let maxLearned = 500

    public init(directory: URL, defaults: UserDefaults = .standard) {
        self.directory = directory
        self.defaults = defaults
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// The shared store: the App Group container if this build is signed with it.
    public static func shared() -> ProfileStore {
        let fm = FileManager.default
        #if canImport(Darwin)
        if let group = fm.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
            return ProfileStore(directory: group.appendingPathComponent("Profiles"),
                                defaults: UserDefaults(suiteName: appGroup) ?? .standard)
        }
        #endif
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? fm.temporaryDirectory
        return ProfileStore(directory: support.appendingPathComponent("KeyPalette/Profiles"))
    }

    private func file(for id: String) -> URL {
        let safe = id.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? String($0) : "_" }.joined()
        return directory.appendingPathComponent("\(safe).json")
    }

    /// Every stored profile, in a steady order (by name).
    public func profiles() -> [Profile] {
        let urls = (try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        return urls
            .filter { $0.pathExtension == "json" }
            .compactMap { try? Profile.decode(Data(contentsOf: $0)) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    public func save(_ profile: Profile) throws {
        try profile.encoded().write(to: file(for: profile.id), options: .atomic)
    }

    public func delete(id: String) {
        try? fm.removeItem(at: file(for: id))
        if activeProfileID == id { activeProfileID = nil }
    }

    /// Copy profiles from a folder (the ones bundled in the app) that aren't stored yet.
    @discardableResult
    public func installMissing(from folder: URL) -> Int {
        let urls = (try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        var n = 0
        for u in urls where u.pathExtension == "json" {
            guard let data = try? Data(contentsOf: u), let p = try? Profile.decode(data) else { continue }
            if !fm.fileExists(atPath: file(for: p.id).path) {
                try? save(p)
                n += 1
            }
        }
        return n
    }

    /// Profiles in a folder, without storing them (the extension's fallback).
    public static func profiles(in folder: URL) -> [Profile] {
        let urls = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        return urls
            .filter { $0.pathExtension == "json" }
            .compactMap { try? Profile.decode(Data(contentsOf: $0)) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    public var activeProfileID: String? {
        get { defaults.string(forKey: Self.activeKey) }
        set { defaults.set(newValue, forKey: Self.activeKey) }
    }

    // MARK: Learned words

    public func learnedWords() -> [String] {
        defaults.stringArray(forKey: Self.learnedKey) ?? []
    }

    public func addLearned(_ word: String) {
        let w = word.lowercased()
        var list = learnedWords()
        guard !list.contains(w) else { return }
        list.append(w)
        defaults.set(Array(list.suffix(Self.maxLearned)), forKey: Self.learnedKey)
    }

    public func clearLearned() {
        defaults.removeObject(forKey: Self.learnedKey)
    }
}
