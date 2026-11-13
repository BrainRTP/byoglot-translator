import Foundation

extension HTTPRequest: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    public var description: String { "HTTPRequest(method: \(method))" }
    public var debugDescription: String { description }
    public var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}

extension HTTPResponse: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    public var description: String { "HTTPResponse(status: \(status), bytes: \(body.count))" }
    public var debugDescription: String { description }
    public var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}

extension ProviderClient: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    public var description: String { "ProviderClient" }
    public var debugDescription: String { description }
    public var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}

extension TextRequest: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    public var description: String { "TextRequest(textLength: \(text.utf16.count))" }
    public var debugDescription: String { description }
    public var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}

extension TextPromptInput: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    public var description: String { "TextPromptInput(textLength: \(text.utf16.count))" }
    public var debugDescription: String { description }
    public var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}

extension BackendError: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    public var description: String { "BackendError(kind: \(kind.rawValue), status: \(status ?? 0))" }
    public var debugDescription: String { description }
    public var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}

extension CompletionDelta: CustomReflectable {
    public var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}

extension TranslationChunk: CustomReflectable {
    public var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}

extension HTTPStreamEvent: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    public var description: String { "HTTPStreamEvent" }
    public var debugDescription: String { description }
    public var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}
