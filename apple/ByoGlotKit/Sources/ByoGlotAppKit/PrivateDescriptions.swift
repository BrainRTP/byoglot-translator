import Foundation

extension RunnerInput: CustomReflectable {
    public var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}

extension RunnerOutput: CustomReflectable {
    public var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}

extension RunnerStreamOutput: CustomReflectable {
    public var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}

extension ConnectionDraft: CustomReflectable {
    public var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}

extension AppModel: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    public nonisolated var description: String { "AppModel" }
    public nonisolated var debugDescription: String { description }
    public nonisolated var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
}
