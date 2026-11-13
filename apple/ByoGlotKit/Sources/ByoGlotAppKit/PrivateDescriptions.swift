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
