// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "ByoGlotKit",
    platforms: [.iOS("27.1"), .macOS("27.0")],
    products: [
        .library(name: "ByoGlotCore", targets: ["ByoGlotCore"]),
        .library(name: "ByoGlotStore", targets: ["ByoGlotStore"]),
    ],
    targets: [
        .target(name: "ByoGlotCore", resources: [.copy("Resources")]),
        .target(name: "ByoGlotStore", dependencies: ["ByoGlotCore"]),
        .testTarget(name: "ByoGlotCoreTests", dependencies: ["ByoGlotCore"]),
        .testTarget(name: "ByoGlotStoreTests", dependencies: ["ByoGlotStore"]),
    ],
    swiftLanguageModes: [.v6]
)
