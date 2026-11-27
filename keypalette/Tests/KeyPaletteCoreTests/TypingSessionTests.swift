import XCTest
@testable import KeyPaletteCore

final class TypingSessionTests: XCTestCase {
    func testCorrectsOnSpace() {
        let f = Field()
        f.type("i like teh ")
        XCTAssertEqual(f.text, "I like the ")
    }

    func testBackspaceRevertsTheCorrectionAndTeachesTheWord() {
        let f = Field()
        f.type("teh ")
        XCTAssertEqual(f.text, "the ")
        let e = f.session.backspace(before: f.text)
        XCTAssertEqual(e.learned, "teh")
        f.apply(e)
        XCTAssertEqual(f.text, "teh", "backspace right after a correction puts back what was typed")
    }

    func testSecondBackspaceDeletesNormally() {
        let f = Field()
        f.type("teh ")
        f.backspace()
        f.backspace()
        XCTAssertEqual(f.text, "te")
    }

    func testContractionsAndCapitalI() {
        let f = Field()
        f.type("i dont knwo ")
        XCTAssertEqual(f.text, "I don't know ")
    }

    func testDoubleSpaceMakesAFullStop() {
        var now = Date(timeIntervalSince1970: 1_800_000_000)
        let engine = Fixtures.engine()
        let s = TypingSession(engine: engine, now: { now })
        var text = ""
        for ch in "hello" { text = s.character(String(ch), before: text).applied(to: text) }
        text = s.space(before: text).applied(to: text)
        now.addTimeInterval(0.2)
        text = s.space(before: text).applied(to: text)
        XCTAssertEqual(text, "hello. ")
    }

    func testDoubleSpaceNeedsToBeQuick() {
        var now = Date(timeIntervalSince1970: 1_800_000_000)
        let s = TypingSession(engine: Fixtures.engine(), now: { now })
        var text = "hello"
        text = s.space(before: text).applied(to: text)
        now.addTimeInterval(1.0)
        text = s.space(before: text).applied(to: text)
        XCTAssertEqual(text, "hello  ")
    }

    func testPunctuationFixesTheWordBeforeIt() {
        let f = Field()
        f.type("thats true, teh.")
        XCTAssertEqual(f.text, "that's true, the.")
    }

    func testShouldCapitaliseAfterASentence() {
        let s = TypingSession(engine: Fixtures.engine())
        XCTAssertTrue(s.shouldCapitalize(before: ""))
        XCTAssertTrue(s.shouldCapitalize(before: "Hello there. "))
        XCTAssertTrue(s.shouldCapitalize(before: "Line one\n"))
        XCTAssertFalse(s.shouldCapitalize(before: "Hello there"))
        XCTAssertFalse(s.shouldCapitalize(before: "Hello there, "))
    }

    func testLeavesUrlsAndHandlesAlone() {
        let f = Field()
        f.type("see www.exmple.com and @jhon ")
        XCTAssertEqual(f.text, "see www.exmple.com and @jhon ")
    }

    func testShortcutsExpandAndBackspaceUndoesThem() {
        let f = Field()
        f.session.shortcuts = ShortcutTable([ShortcutEntry(trigger: ";gg", expansion: "good game")])
        f.type(";gg ")
        XCTAssertEqual(f.text, "good game ")
        f.backspace()
        XCTAssertEqual(f.text, ";gg")
    }

    func testShortcutWithACursorMarker() {
        let f = Field()
        f.session.shortcuts = ShortcutTable([ShortcutEntry(trigger: ";hi", expansion: "Hello {cursor}!")])
        let e = f.session.space(before: ";hi")
        XCTAssertEqual(e.insert, "Hello ! ")
        XCTAssertEqual(e.cursorBack, 2, "back over the ! and the space")
    }

    func testAcceptingASuggestionAddsASpaceAndArmsDoubleSpace() {
        let f = Field()
        f.type("see you tom")
        let s = f.session.suggestions(before: f.text)
        let tomorrow = s.first { $0.value == "tomorrow" }
        XCTAssertNotNil(tomorrow, s.map(\.label).joined(separator: ","))
        f.apply(f.session.accept(tomorrow!, before: f.text))
        XCTAssertEqual(f.text, "see you tomorrow ")
        f.type(".")
        XCTAssertEqual(f.text, "see you tomorrow. ", "punctuation after a suggestion tucks in against the word")
    }

    func testSuggestionsOfferTheCorrectionInTheMiddle() {
        let s = TypingSession(engine: Fixtures.engine())
        let out = s.suggestions(before: "teh")
        XCTAssertEqual(out.first?.kind, .literal)
        XCTAssertEqual(out.dropFirst().first?.value, "the")
        XCTAssertEqual(out.dropFirst().first?.primary, true)
    }

    func testAtASentenceStartTheBarOffersStarters() {
        let s = TypingSession(engine: Fixtures.engine())
        let out = s.suggestions(before: "")
        XCTAssertFalse(out.isEmpty)
        XCTAssertEqual(out.first(where: \.primary)?.value, "I")
    }

    func testAutocorrectCanBeTurnedOff() {
        let f = Field()
        f.session.autocorrect = false
        f.type("teh ")
        XCTAssertEqual(f.text, "teh ")
    }
}
