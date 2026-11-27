import XCTest
@testable import KeyPaletteCore

final class LayoutTests: XCTestCase {
    func testLettersLayerHasTheSwipeUpAlternates() {
        let rows = Layouts.rows(.letters)
        XCTAssertEqual(rows.count, 4)
        XCTAssertEqual(rows[0].map { $0.char ?? "" }.joined(), "qwertyuiop")
        XCTAssertEqual(rows[0].map { $0.alt ?? "" }.joined(), "1234567890")
        XCTAssertEqual(rows[1].map { $0.alt ?? "" }.joined(), "@#$&*()'\"")
        XCTAssertEqual(rows[2].compactMap { $0.alt }.joined(), "%-+=/;:")
    }

    func testEveryLayerEndsWithSpaceAndReturn() {
        for layer in [LayerName.letters, .numbers, .symbols] {
            let last = Layouts.rows(layer).last!
            XCTAssertEqual(last.compactMap(\.action), [.layer, .space, .enter], "\(layer)")
        }
    }

    func testNeighboursAreSymmetricAndPhysical() {
        XCTAssertTrue(Layouts.neighbours["q"]!.contains("w"))
        XCTAssertTrue(Layouts.neighbours["w"]!.contains("q"))
        XCTAssertFalse(Layouts.neighbours["q"]!.contains("p"))
        for (a, set) in Layouts.neighbours { for b in set { XCTAssertTrue(Layouts.neighbours[b]!.contains(a), "\(a)/\(b)") } }
    }

    func testCaseCycling() {
        XCTAssertEqual(TextHelpers.nextCase("john"), "John")
        XCTAssertEqual(TextHelpers.nextCase("John"), "JOHN")
        XCTAssertEqual(TextHelpers.nextCase("JOHN"), "john")
    }
}
