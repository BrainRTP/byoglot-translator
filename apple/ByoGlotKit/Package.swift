// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "ByoGlotKit",
    platforms: [.iOS("27.1"), .macOS("27.0")],
    products: [
        .library(name: "ByoGlotCore", targets: ["ByoGlotCore"]),
        .library(name: "ByoGlotStore", targets: ["ByoGlotStore"]),
        .library(name: "ByoGlotStoreTesting", targets: ["ByoGlotStoreTesting"]),
    ],
    targets: [
        .target(name: "ByoGlotCore", resources: [.copy("Resources")]),
        .target(name: "ByoGlotStore", dependencies: ["ByoGlotCore"]),
        .target(name: "ByoGlotStoreTesting", dependencies: ["ByoGlotStore"]),
        .testTarget(name: "ByoGlotCoreTests", dependencies: ["ByoGlotCore"]),
        .testTarget(name: "ByoGlotStoreTests", dependencies: ["ByoGlotStore", "ByoGlotStoreTesting"]),
    ],
    swiftLanguageModes: [.v6]
)
