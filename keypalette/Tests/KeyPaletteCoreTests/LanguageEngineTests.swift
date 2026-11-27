import XCTest
@testable import KeyPaletteCore

final class LanguageEngineTests: XCTestCase {
    let engine = Fixtures.engine()

    func testLoadsTheDictionary() {
        XCTAssertGreaterThan(engine.dictionarySize, 25_000)
    }

    func testFixesCommonTypos() {
        let cases: [String: String?] = [
            "teh": "the", "recieve": "receive", "becuase": "because", "tomorow": "tomorrow",
            "definately": "definitely", "thier": "their", "wierd": "weird", "jsut": "just",
            "meetign": "meeting", "realy": "really", "sonething": "something",
            "peopel": "people", "wiht": "with", "abotu": "about", "yoyr": "your", "adress": "address",
            "tge": "the", "ans": nil, "lookin": "looking", "happend": "happened", "untill": "until",
            "seperate": "separate", "occured": "occurred",
        ]
        var misses: [String] = []
        for (typo, want) in cases {
            let got = engine.correct(typo)
            if got != want { misses.append("\(typo) -> \(got ?? "nil") (want \(want ?? "nil"))") }
        }
        XCTAssertEqual(misses, [])
    }

    func testLeavesValidWordsNamesAndAcronymsAlone() {
        for w in ["hello", "their", "there", "its", "were", "NASA", "API"] {
            XCTAssertNil(engine.correct(w), w)
        }
        XCTAssertNil(engine.correct("Zorblax"))
    }

    func testContractionsAndCapitalI() {
        XCTAssertEqual(engine.correct("im"), "I'm")
        XCTAssertEqual(engine.correct("i"), "I")
        XCTAssertEqual(engine.correct("dont"), "don't")
        XCTAssertEqual(engine.correct("Dont", sentenceStart: true), "Don't")
        XCTAssertNil(engine.correct("ill"))
    }

    func testLearnedWordsAreNeverCorrected() {
        engine.learned = ["palate", "gonna"]
        XCTAssertNil(engine.correct("palate"))
        engine.learned = []
    }

    func testPreservesCapitalisation() {
        XCTAssertEqual(engine.correct("Teh", sentenceStart: true), "The")
        XCTAssertNil(engine.correct("TEH")) // all caps is read as an acronym
    }

    func testCompletionsRankByFrequency() {
        XCTAssertTrue(engine.complete(prefix: "tom", k: 3).contains("tomorrow"))
        XCTAssertEqual(engine.complete(prefix: "i", k: 1).first, "I")
    }

    func testNextLetterProbabilitiesFavourRealContinuations() {
        let p = engine.nextLetterProbs(prefix: "th")
        XCTAssertGreaterThan(p["e"] ?? 0, 0.3)
        XCTAssertGreaterThan(p["e"] ?? 0, p["x"] ?? 0)
    }

    func testCorrectionIsFastEnoughToRunPerWord() {
        let start = Date()
        for _ in 0..<50 { _ = engine.correct("sonethimg") }
        let per = Date().timeIntervalSince(start) / 50 * 1000
        // The real budget (15 ms) is for the optimised build, which is what ships;
        // CI enforces it in a release-build step. A debug build is unoptimised and runs
        // on shared machines (117 ms was seen), so there it only guards against a
        // pathological slowdown.
        #if DEBUG
        let budget = 500.0
        #else
        let budget = 15.0
        #endif
        print("correction: \(String(format: "%.2f", per)) ms each")
        XCTAssertLessThan(per, budget, "\(per) ms per correction")
    }

    func testSentenceStartersCanBeSetAndReset() {
        engine.setStarters(["Good", "Works", "Make"])
        XCTAssertEqual(engine.nextWords(context: [], k: 3, sentenceStart: true), ["Good", "Works", "Make"])
        engine.setStarters([])
        XCTAssertEqual(engine.nextWords(context: [], k: 1, sentenceStart: true).first, "I")
    }

    func testPersonalVocabularyIsKnownAndNeverCorrected() {
        engine.personal = ["railgun": 3, "saltgate": 3]
        XCTAssertTrue(engine.isKnown("railgun"))
        XCTAssertNil(engine.correct("railgun"))
        XCTAssertNil(engine.correct("Saltgate", sentenceStart: true))
    }

    func testPersonalVocabularyIsAnAutocorrectTarget() {
        engine.personal = ["railgun": 3]
        XCTAssertEqual(engine.correct("railgnu"), "railgun")
    }
}
