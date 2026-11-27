import XCTest
@testable import KeyPaletteCore

final class ProfileTests: XCTestCase {
    func cargo() -> Profile {
        Profile(
            id: "cargo-ship", name: "Cargo Ship", icon: "⚓️",
            words: ["railgun": 3, "frigate": 3, "saltgate": 3, "torpedo": 3, "overlap": 4],
            starters: ["Good", "Make", "Works"],
            bigrams: ["good": ["overall": 13, "but": 12], "make": ["sure": 14, "it": 18]],
            trigrams: ["good overall": ["but": 5]],
            typoFixes: ["missle": "missile", "damange": "damage", "cna": "can", "teh": "the"],
            phraseFixes: [
                PhraseFix(pattern: "\\bdual (?:weld|wheel|wield)\\b", replacement: "Dual Wield"),
                PhraseFix(pattern: "\\btesla lab\\b", replacement: "Test Lab"),
                PhraseFix(pattern: "\\bstargate (?:matt|map)\\b", replacement: "Saltgate map"),
                PhraseFix(pattern: "\\bthe (?:a ?ten|a-10|10|ten) warthog\\b", replacement: "the A-10 Warthog"),
                PhraseFix(pattern: "(?<!the )(?<![-A-Za-z0-9])(?:an? )?(?:a ?ten|a-10|10|ten) warthog\\b", replacement: "an A-10 Warthog"),
            ],
            shortcuts: [ShortcutEntry(trigger: ";gg", expansion: "good game")],
            hotkeys: [
                Hotkey(label: "✓ Fix", action: "fix"),
                Hotkey(label: "Good", insert: "Good overall. ", alt: HotkeyAction(label: "works", insert: "Works as expected. ")),
            ]
        )
    }

    func testRoundTripsThroughJSON() throws {
        let p = cargo()
        let back = try Profile.decode(p.encoded())
        XCTAssertEqual(back, p)
    }

    func testOnlyIdAndNameAreRequiredInTheFile() throws {
        let p = try Profile.decode(Data(#"{"id":"x","name":"X"}"#.utf8))
        XCTAssertEqual(p.id, "x")
        XCTAssertEqual(p.icon, "🎨")
        XCTAssertTrue(p.words.isEmpty)
        XCTAssertTrue(p.hotkeys.isEmpty)
    }

    func testRefusesAProfileFromANewerSchema() {
        XCTAssertThrowsError(try Profile.decode(Data(#"{"schema":99,"id":"x","name":"X"}"#.utf8))) {
            XCTAssertEqual($0 as? ProfileError, .newerSchema(99))
        }
    }

    func testSwitchingProfileChangesWhatIsCorrected() {
        let brain = Brain(words: Fixtures.words)
        XCTAssertNotEqual(brain.engine.correct("railgun"), nil, "plain typing doesn't know railgun")
        brain.activate(cargo())
        XCTAssertNil(brain.engine.correct("railgun"), "the Cargo Ship profile does")
        brain.activate(.plain)
        XCTAssertNotNil(brain.engine.correct("railgun"))
    }

    func testProfileWordsAreSuggestedAndTypoTargets() {
        let brain = Brain(words: Fixtures.words, profile: cargo())
        XCTAssertEqual(brain.engine.correct("railgnu"), "railgun")
        XCTAssertTrue(brain.engine.complete(prefix: "salt", k: 3).contains("saltgate"))
    }

    func testPhraseModelDrivesSuggestions() {
        let brain = Brain(words: Fixtures.words, profile: cargo())
        let after = brain.session.suggestions(before: "good ")
        XCTAssertEqual(after.first(where: \.primary)?.value, "overall", after.map(\.label).joined(separator: ","))
        let makeNext = brain.session.suggestions(before: "make ").first(where: \.primary)?.value
        XCTAssertTrue(["it", "sure"].contains(makeNext ?? ""), makeNext ?? "nil")
    }

    func testProfileStartersReplaceTheDefaults() {
        let brain = Brain(words: Fixtures.words, profile: cargo())
        XCTAssertEqual(brain.session.suggestions(before: "").first(where: \.primary)?.value, "Good")
    }

    func testFixCorrectsTyposAndDictationMishears() {
        let brain = Brain(words: Fixtures.words, profile: cargo())
        let f = brain.fixer
        XCTAssertEqual(f.fix("The missle did damange and I cna see it"), "The missile did damage and I can see it")
        XCTAssertEqual(f.fix("Dual weld is great"), "Dual Wield is great")
        XCTAssertEqual(f.fix("in this Tesla lab"), "in this Test Lab")
        XCTAssertEqual(f.fix("Stargate Matt is better"), "Saltgate map is better")
        XCTAssertEqual(f.fix("look like a 10 warthog"), "look like an A-10 Warthog")
        XCTAssertEqual(f.fix("the 10 warthog is cool"), "the A-10 Warthog is cool")
    }

    func testFixIsIdempotent() {
        let brain = Brain(words: Fixtures.words, profile: cargo())
        for t in ["The missle did damange to Dual weld, cna you see it", "the 10 warthog and a ten warthog", "Stargate Matt in the Tesla lab"] {
            let once = brain.fixer.fix(t)
            XCTAssertEqual(brain.fixer.fix(once), once, t)
        }
    }

    func testFixLeavesRightTextContractionsAndGameWordsAlone() {
        let brain = Brain(words: Fixtures.words, profile: cargo())
        for t in [
            "She'll say it's fine, we're done, wasn't it? What’s next",
            "The Torpedo and the railgun, frigate and Saltgate.",
            "Good overall. Make sure the nuke clears the screen.",
            "Wayyyy too easy, ooooh well",
        ] {
            XCTAssertEqual(brain.fixer.fix(t), t, t)
        }
    }

    func testFixHotkeyReturnsAnEditOverTheTextBeforeTheCaret() {
        let brain = Brain(words: Fixtures.words, profile: cargo())
        let e = brain.run(action: "fix", before: "teh missle")
        XCTAssertEqual(e.applied(to: "teh missle"), "the missile")
        XCTAssertTrue(brain.run(action: "fix", before: "All good.").isEmpty)
    }

    func testShortcutsAreSwappedWithTheProfile() {
        let brain = Brain(words: Fixtures.words, profile: cargo())
        let s = brain.session
        var text = ";gg"
        text = s.space(before: text).applied(to: text)
        XCTAssertEqual(text, "good game ")
        brain.activate(.plain)
        XCTAssertNil(brain.session.shortcuts.expansion(for: ";gg"))
        XCTAssertNotNil(brain.session.shortcuts.expansion(for: ";d"), "the date shortcut is always there")
    }

    func testTemplates() {
        let t = Template.expand("Hello {cursor}!", now: Date(timeIntervalSince1970: 1_800_000_000))
        XCTAssertEqual(t.text, "Hello !")
        XCTAssertEqual(t.cursorBack, 1)
        XCTAssertTrue(Template.expand("{iso}").text.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil)
    }
}
