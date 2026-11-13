// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "ByoGlotKit",
    defaultLocalization: "en",
    platforms: [.iOS("27.1"), .macOS("27.0")],
    products: [
        .library(name: "ByoGlotAppKit", targets: ["ByoGlotAppKit"]),
        .library(name: "ByoGlotCore", targets: ["ByoGlotCore"]),
        .library(name: "ByoGlotStore", targets: ["ByoGlotStore"]),
        .library(name: "ByoGlotStoreTesting", targets: ["ByoGlotStoreTesting"]),
        .library(name: "ByoGlotBridge", targets: ["ByoGlotBridge"]),
    ],
    targets: [
        .target(name: "ByoGlotAppKit", dependencies: ["ByoGlotCore", "ByoGlotStore"], resources: [.process("Resources")]),
        .target(name: "ByoGlotCore", resources: [.copy("Resources/contracts"), .copy("Resources/profiles")]),
        .target(name: "ByoGlotStore", dependencies: ["ByoGlotCore"]),
        .target(name: "ByoGlotStoreTesting", dependencies: ["ByoGlotStore"]),
        .target(name: "ByoGlotBridge", dependencies: ["ByoGlotCore", "ByoGlotStore"]),
        .testTarget(name: "ByoGlotAppKitTests", dependencies: ["ByoGlotAppKit"]),
        .testTarget(name: "ByoGlotCoreTests", dependencies: ["ByoGlotCore"]),
        .testTarget(name: "ByoGlotStoreTests", dependencies: ["ByoGlotStore", "ByoGlotStoreTesting"]),
        .testTarget(name: "ByoGlotBridgeTests", dependencies: ["ByoGlotBridge"]),
    ],
    swiftLanguageModes: [.v6]
)
