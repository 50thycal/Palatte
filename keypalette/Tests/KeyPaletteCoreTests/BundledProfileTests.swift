import XCTest
@testable import KeyPaletteCore

/// The Cargo Ship profile shipped in Resources/profiles, generated from the
/// game's own data (its note keyboard). These are the same checks the game's
/// JavaScript tests make, run through the Swift engine.
final class BundledProfileTests: XCTestCase {
    static let profile: Profile = {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Resources/profiles/cargo-ship.json")
        return try! Profile.decode(Data(contentsOf: url))
    }()

    var brain: Brain { Brain(words: Fixtures.words, profile: Self.profile) }

    func testLoads() {
        let p = Self.profile
        XCTAssertEqual(p.id, "cargo-ship")
        XCTAssertGreaterThan(p.words.count, 500)
        XCTAssertEqual(p.hotkeys.first?.action, "fix")
        XCTAssertEqual(p.hotkeys.count, 8)
    }

    func testEveryPhraseFixIsAValidRegex() {
        for r in Self.profile.phraseFixes {
            XCTAssertNoThrow(try NSRegularExpression(pattern: r.pattern, options: .caseInsensitive), r.pattern)
        }
    }

    func testEveryHotkeyDoesSomething() {
        for h in Self.profile.hotkeys {
            XCTAssertTrue(h.insert != nil || h.action != nil || h.layer != nil, h.label)
        }
    }

    func testTheGamesWordsAreKnownAndNeverCorrected() {
        let b = brain
        for w in ["railgun", "frigate", "grapnel", "saltgate", "kesh", "dreadnought", "scattergun", "aegis"] {
            XCTAssertTrue(b.engine.isKnown(w), w)
            XCTAssertNil(b.engine.correct(w), w)
        }
    }

    func testFixesTyposFromTheNotes() {
        let f = brain.fixer
        XCTAssertEqual(f.fix("The missle did damange and I cna see the radui"), "The missile did damage and I can see the radius")
        XCTAssertEqual(f.fix("Frigets just overlap, iust a prbs of the senarjos"), "Frigates just overlap, just a probably of the scenarios")
    }

    func testFixesDictationOfTheGamesNames() {
        let f = brain.fixer
        XCTAssertEqual(f.fix("Dual weld is great"), "Dual Wield is great")
        XCTAssertEqual(f.fix("I dual wheel it"), "I Dual Wield it")
        XCTAssertEqual(f.fix("Make the plane look like a 10 warthog"), "Make the plane look like an A-10 Warthog")
        XCTAssertEqual(f.fix("Make it faster and an a ten worthhog"), "Make it faster and an A-10 Warthog")
        XCTAssertEqual(f.fix("the 10 warthog is cool"), "the A-10 Warthog is cool")
        XCTAssertEqual(f.fix("Stargate Matt is better"), "Saltgate map is better")
        XCTAssertEqual(f.fix("in this Tesla lab"), "in this Test Lab")
        XCTAssertEqual(f.fix("the oral strike upgrade"), "the Orbital Strike upgrade")
        XCTAssertEqual(f.fix("The can all gate did not work"), "The canal gate did not work")
        XCTAssertEqual(f.fix("slow down Hydro a bit"), "slow down Hydra a bit")
    }

    func testLeavesRightTextAlone() {
        let f = brain.fixer
        for t in [
            "She'll say it's fine, we're done, wasn't it? What’s next",
            "The Torpedo Sub and the railgun, frigate, grapnel, Saltgate and Kesh.",
            "Good overall. Make sure the nuke clears the screen.",
            "Wayyyy too easy, ooooh well",
        ] {
            XCTAssertEqual(f.fix(t), t, t)
        }
    }

    func testFixIsIdempotent() {
        let f = brain.fixer
        for t in ["The missle did damange to Dual weld, cna you see it", "the 10 warthog and a ten warthog", "Stargate Matt in the Tesla lab"] {
            let once = f.fix(t)
            XCTAssertEqual(f.fix(once), once, t)
        }
    }

    func testSuggestionsFollowTheirPhrasing() {
        let b = brain
        let values = b.session.suggestions(before: "good ").map(\.value)
        XCTAssertTrue(values.contains("overall"), values.joined(separator: ","))
        XCTAssertEqual(b.session.suggestions(before: "good ").first(where: \.primary)?.value, "overall")
        XCTAssertTrue(b.session.suggestions(before: "works ").map(\.value).contains("good"))
    }

    func testTheirSentenceOpenersAreOffered() {
        let openers = Set(brain.session.suggestions(before: "").map(\.value))
        XCTAssertFalse(openers.isDisjoint(with: ["Good", "Make", "Also", "This"]), "\(openers)")
    }

    func testSwitchingBackToPlainDropsTheGameVocabulary() {
        let b = brain
        b.activate(.plain)
        XCTAssertNotNil(b.engine.correct("railgun"))
    }
}
