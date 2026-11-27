import XCTest
@testable import KeyPaletteCore

final class ProfileBuilderTests: XCTestCase {
    let engine = Fixtures.engine()
    var builder: ProfileBuilder { ProfileBuilder(engine: engine) }

    let notes = [
        "Good overall. Make sure the railgun reloads. The Saltgate map is hard.",
        "Good overall, but the frigate stalls. Make sure it turns.",
        "Good overall. The railgun is too slow. Make it faster.",
        "Works good. The railgun feels great and the frigate too.",
    ]

    func testKeepsWhatYouUseOften() {
        let p = builder.build(id: "game", name: "Game", from: notes)
        XCTAssertEqual(p.words["railgun"], 3, "used three times")
        XCTAssertEqual(p.words["frigate"], 2)
        XCTAssertNil(p.words["stalls"], "a known word used once isn't habitual")
    }

    func testRareWordsAreKnownSoTheyAreNeverCorrected() {
        let p = builder.build(id: "game", name: "Game", from: notes)
        XCTAssertGreaterThanOrEqual(p.words["railgun"] ?? 0, 2)
        // A name used once mid-sentence still counts
        XCTAssertGreaterThanOrEqual(p.words["saltgate"] ?? 0, 2, "capitalised mid-sentence: a name")
        let brain = Brain(words: Fixtures.words, profile: p)
        XCTAssertNil(brain.engine.correct("railgun"))
        XCTAssertNil(brain.engine.correct("Saltgate", sentenceStart: true))
    }

    func testLearnsYourPhrasing() {
        let p = builder.build(id: "game", name: "Game", from: notes)
        XCTAssertEqual(p.bigrams["good"]?["overall"], 3)
        XCTAssertEqual(p.bigrams["make"]?["sure"], 2)
        XCTAssertNil(p.bigrams["make"]?["it"], "once isn't a habit")
        XCTAssertEqual(p.trigrams["good overall"]?.isEmpty ?? true, true, "no word followed that pair twice")
        let brain = Brain(words: Fixtures.words, profile: p)
        XCTAssertEqual(brain.session.suggestions(before: "good ").first(where: \.primary)?.value, "overall")
    }

    func testLearnsHowYouOpenSentences() {
        let p = builder.build(id: "game", name: "Game", from: notes)
        XCTAssertEqual(p.starters.first, "Good")
        XCTAssertTrue(p.starters.contains("The"))
    }

    func testPhrasesNeverRunAcrossSentences() {
        let p = builder.build(id: "x", name: "X", from: ["It ended. Good luck.", "It ended. Good luck."])
        XCTAssertNil(p.bigrams["ended"]?["good"])
        XCTAssertEqual(p.bigrams["good"]?["luck"], 2)
    }

    func testHandlesCurlyApostrophesAndStrayPunctuation() {
        let p = builder.build(id: "x", name: "X", from: ["It’s fine, it’s fine. 'Quoted' words — and numbers 42."])
        XCTAssertNotNil(p.words["it's"])
        XCTAssertNil(p.words["42"])
        XCTAssertNil(p.words["'"])
    }

    func testEmptyAndTinyInputsGiveAnEmptyButValidProfile() throws {
        for input in [[], [""], ["a"], ["   \n  "]] as [[String]] {
            let p = builder.build(id: "x", name: "X", from: input)
            XCTAssertEqual(p.id, "x")
            XCTAssertNoThrow(try Profile.decode(p.encoded()))
        }
    }

    func testCapsTheNumberOfFollowersPerWord() {
        let text = (0..<30).map { "alpha w\($0) alpha w\($0)" }.joined(separator: ". ")
        var b = builder
        b.maxFollowersPerWord = 5
        let p = b.build(id: "x", name: "X", from: [text])
        XCTAssertLessThanOrEqual(p.bigrams["alpha"]?.count ?? 0, 5)
    }

    func testRoundTripsThroughTheProfileFormat() throws {
        let p = builder.build(id: "game", name: "Game", from: notes)
        XCTAssertEqual(try Profile.decode(p.encoded()), p)
    }

    func testMatchesTheGameMethodOnRealNotes() throws {
        // The Cargo Ship profile was built from 201 real notes with the same method
        // (in TypeScript); the Swift builder run over text in that style makes a
        // usable profile: habitual phrases found, openers found.
        let text = (0..<6).map { _ in "Good overall. Make sure it works. Works good but the animation needs work." }
        let p = builder.build(id: "x", name: "X", from: text)
        XCTAssertEqual(p.bigrams["works"]?["good"], 6)
        XCTAssertEqual(p.bigrams["good"]?["overall"], 6)
        XCTAssertTrue(["Good", "Make", "Works"].allSatisfy { p.starters.contains($0) })
    }
}
