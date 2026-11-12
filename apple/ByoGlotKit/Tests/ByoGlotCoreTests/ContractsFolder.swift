import Foundation
import Testing

struct ContractCase<I: Decodable & Sendable, E: Decodable & Sendable>: Decodable, Sendable {
    let name: String
    let input: I
    let expected: E
}

enum ContractsFolder {
    static let url: URL = {
        var candidate = URL(filePath: #filePath).deletingLastPathComponent()
        while candidate.path != "/" {
            let contracts = candidate.appending(path: "contracts")
            if FileManager.default.fileExists(atPath: contracts.appending(path: "README.md").path) {
                return contracts
            }
            candidate.deleteLastPathComponent()
        }
        fatalError("Cannot find contracts/README.md")
    }()

    static func fixture<I: Decodable & Sendable, E: Decodable & Sendable>(
        _ name: String, input: I.Type, expected: E.Type
    ) throws -> [ContractCase<I, E>] {
        let data = try Data(contentsOf: url.appending(path: "fixtures/\(name).json"))
        let envelope = try JSONDecoder().decode(Envelope<I, E>.self, from: data)
        guard envelope.contract == name, envelope.version == 1, !envelope.cases.isEmpty else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return envelope.cases
    }

    private struct Envelope<I: Decodable & Sendable, E: Decodable & Sendable>: Decodable {
        let contract: String
        let version: Int
        let cases: [ContractCase<I, E>]
    }
}

@Test func contractsFolderIsFound() {
    #expect(FileManager.default.fileExists(atPath: ContractsFolder.url.appending(path: "fixtures/prompt-text.json").path))
}
