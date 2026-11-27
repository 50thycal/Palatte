import XCTest
@testable import KeyPaletteCore

final class ProfileStoreTests: XCTestCase {
    var dir: URL!
    var defaults: UserDefaults!

    override func setUp() {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("kp-\(UUID().uuidString)")
        defaults = UserDefaults(suiteName: "kp-test-\(UUID().uuidString)")!
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dir)
    }

    func testSaveListAndDelete() throws {
        let store = ProfileStore(directory: dir, defaults: defaults)
        try store.save(Profile(id: "b", name: "Beta"))
        try store.save(Profile(id: "a", name: "alpha"))
        XCTAssertEqual(store.profiles().map(\.name), ["alpha", "Beta"], "sorted by name, ignoring case")
        store.delete(id: "a")
        XCTAssertEqual(store.profiles().map(\.id), ["b"])
    }

    func testTheActiveProfileIsRemembered() throws {
        let store = ProfileStore(directory: dir, defaults: defaults)
        XCTAssertNil(store.activeProfileID)
        store.activeProfileID = "cargo"
        XCTAssertEqual(store.activeProfileID, "cargo")
        store.delete(id: "cargo")
        XCTAssertNil(store.activeProfileID, "deleting the active profile clears it")
    }

    func testInstallingBundledProfilesNeverOverwritesEdits() throws {
        let bundled = dir.appendingPathComponent("bundled")
        try FileManager.default.createDirectory(at: bundled, withIntermediateDirectories: true)
        try Profile(id: "cargo", name: "Cargo Ship", words: ["railgun": 3]).encoded().write(to: bundled.appendingPathComponent("cargo.json"))
        let store = ProfileStore(directory: dir.appendingPathComponent("store"), defaults: defaults)
        XCTAssertEqual(store.installMissing(from: bundled), 1)

        var edited = store.profiles()[0]
        edited.words["sunspear"] = 3
        try store.save(edited)
        XCTAssertEqual(store.installMissing(from: bundled), 0, "already stored")
        XCTAssertEqual(store.profiles()[0].words["sunspear"], 3, "the edit survives")
    }

    func testSkipsFilesThatAreNotProfiles() throws {
        let store = ProfileStore(directory: dir, defaults: defaults)
        try store.save(Profile(id: "ok", name: "Ok"))
        try Data("not json".utf8).write(to: dir.appendingPathComponent("junk.json"))
        try Data(#"{"schema":99,"id":"future","name":"Future"}"#.utf8).write(to: dir.appendingPathComponent("future.json"))
        XCTAssertEqual(store.profiles().map(\.id), ["ok"])
    }

    func testUnsafeIdsStayInsideTheFolder() throws {
        let store = ProfileStore(directory: dir, defaults: defaults)
        try store.save(Profile(id: "../../evil", name: "Evil"))
        let files = try FileManager.default.contentsOfDirectory(atPath: dir.path)
        XCTAssertEqual(files.count, 1)
        XCTAssertTrue(files[0].hasSuffix(".json"))
        XCTAssertFalse(files[0].contains("/"))
    }

    func testLearnedWordsAreKeptAndCapped() {
        let store = ProfileStore(directory: dir, defaults: defaults)
        store.addLearned("Palate")
        store.addLearned("palate")
        XCTAssertEqual(store.learnedWords(), ["palate"])
        for i in 0..<600 { store.addLearned("w\(i)") }
        XCTAssertEqual(store.learnedWords().count, 500)
        XCTAssertEqual(store.learnedWords().last, "w599")
        store.clearLearned()
        XCTAssertTrue(store.learnedWords().isEmpty)
    }
}
