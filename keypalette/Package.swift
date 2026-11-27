// swift-tools-version:5.9
import PackageDescription

// Key Palette's shared code. KeyPaletteCore is pure Swift (no UIKit) so it is
// built and tested on any machine, Linux included. KeyPaletteUI is the UIKit
// keyboard view, shared by the keyboard extension and the app's playground; it
// compiles to nothing where UIKit isn't available.
let package = Package(
    name: "KeyPaletteKit",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "KeyPaletteCore", targets: ["KeyPaletteCore"]),
        .library(name: "KeyPaletteUI", targets: ["KeyPaletteUI"]),
    ],
    targets: [
        .target(name: "KeyPaletteCore"),
        .target(name: "KeyPaletteUI", dependencies: ["KeyPaletteCore"]),
        .testTarget(name: "KeyPaletteCoreTests", dependencies: ["KeyPaletteCore"]),
    ]
)
