import Foundation
import Testing
@testable import ByoGlotCore

struct HTTPDestinationPolicyTests {
    @Test(arguments: [
        "localhost", "127.0.0.1", "127.255.255.254", "10.0.0.1", "10.255.255.254",
        "172.16.0.1", "172.31.255.254", "192.168.0.1", "169.254.0.1", "model.local",
        "[::1]", "[0:0:0:0:0:0:0:1]", "[fc00::1]", "[fdff::1]", "[fe80::1]", "[febf::1]",
    ])
    func allowsHTTPToLocalAndLANHosts(_ host: String) async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TransportStub.self]
        let transport = URLSessionTransport(configuration: configuration)
        let url = try #require(URL(string: "http://\(host)/finish"))
        #expect(HTTPDestinationPolicy.permits(url))
        #expect(try await transport.send(HTTPRequest(method: "GET", url: url, headers: [:]), timeout: .seconds(5)).status == 200)
    }

    @Test(arguments: [
        "models.example.com", "8.8.8.8", "172.15.255.255", "172.32.0.1", "192.169.0.1", "169.255.0.1",
        "model.local.example.com", "[::]", "[2001:4860::1]", "[fec0::1]", "[ff00::1]",
    ])
    func refusesHTTPToPublicHostsBeforeSending(_ host: String) async throws {
        let url = try #require(URL(string: "http://\(host)/models"))
        #expect(!HTTPDestinationPolicy.permits(url))
        do {
            _ = try await URLSessionTransport().send(HTTPRequest(method: "GET", url: url, headers: [:]), timeout: .seconds(5))
            Issue.record("Expected insecure destination rejection")
        } catch { #expect((error as? URLError)?.code == .appTransportSecurityRequiresSecureConnection) }
        let recording = RecordingTransport(HTTPResponse(status: 200, headers: [:], body: Data(#"{"data":[]}"#.utf8)))
        let client = ProviderClient(connection: Connection(id: "c1", preset: .custom, name: "Insecure", baseUrl: "http://\(host)"), secret: nil, transport: recording)
        do {
            _ = try await client.listModels()
            Issue.record("Expected insecure destination rejection")
        } catch { #expect(error == BackendError(kind: .offline)) }
        #expect(await recording.lastRequest == nil)
    }

    @Test func loopbackConsentAndCustomKeyRequirements() {
        for host in ["localhost", "127.0.0.1", "127.0.0.2", "127.255.255.254", "[::1]", "[0:0:0:0:0:0:0:1]"] {
            #expect(HTTPDestinationPolicy.isLoopback(host))
            #expect(!ProviderEffort.needsKey(preset: .custom, baseUrl: "http://\(host)/v1"))
        }
        for host in ["10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.0.1", "model.local", "[fd00::1]", "[fe80::1]", "models.example.com"] {
            #expect(!HTTPDestinationPolicy.isLoopback(host))
            #expect(ProviderEffort.needsKey(preset: .custom, baseUrl: "http://\(host)/v1"))
        }
        #expect(!ProviderEffort.needsKey(preset: .custom, baseUrl: "ftp://localhost/v1"))
        #expect(HTTPDestinationPolicy.permits(URL(string: "https://models.example.com/v1")!))
        #expect(!HTTPDestinationPolicy.permits(URL(string: "ftp://localhost/v1")!))
    }

    @Test(arguments: [ProviderPreset.ollama, .lmstudio])
    func localPresetsNeedKeysOnlyAtExternalHosts(_ preset: ProviderPreset) {
        for host in ["localhost", "127.0.0.1", "127.0.0.2", "[::1]", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.0.1", "model.local", "[fc00::1]", "[fe80::1]"] {
            #expect(!ProviderEffort.needsKey(preset: preset, baseUrl: "https://\(host)/v1"))
        }
        for host in ["models.example.com", "8.8.8.8", "172.15.255.255", "172.32.0.1", "[2001:4860::1]", "[fec0::1]"] {
            #expect(ProviderEffort.needsKey(preset: preset, baseUrl: "https://\(host)/v1"))
        }
        #expect(ProviderEffort.needsKey(preset: preset, baseUrl: "invalid"))
        for preset in [ProviderPreset.deepseek, .openrouter, .openai, .mistral] {
            #expect(ProviderEffort.needsKey(preset: preset, baseUrl: "https://localhost/v1"))
        }
    }
}
