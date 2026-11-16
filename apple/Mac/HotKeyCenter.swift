import Carbon
import ByoGlotMacKit

@MainActor
final class HotKeyCenter {
    private static var nextID: UInt32 = 0
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private var action: (() -> Void)?
    private var id: UInt32 = 0

    func register(_ shortcut: Shortcut, action: @escaping () -> Void) -> Bool {
        unregister()
        Self.nextID += 1
        id = Self.nextID
        self.action = action
        var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            return MainActor.assumeIsolated {
                let center = Unmanaged<HotKeyCenter>.fromOpaque(context).takeUnretainedValue()
                var received = EventHotKeyID()
                guard GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &received) == noErr,
                      received.signature == 0x42594F47, received.id == center.id else { return OSStatus(eventNotHandledErr) }
                center.action?()
                return noErr
            }
        }, 1, &type, Unmanaged.passUnretained(self).toOpaque(), &handler)
        guard status == noErr else { unregister(); return false }
        let keyStatus = RegisterEventHotKey(shortcut.keyCode, shortcut.modifiers, EventHotKeyID(signature: 0x42594F47, id: id), GetApplicationEventTarget(), OptionBits(kEventHotKeyExclusive), &hotKey)
        guard keyStatus == noErr else { unregister(); return false }
        return true
    }

    func unregister() {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let handler { RemoveEventHandler(handler) }
        hotKey = nil
        handler = nil
        action = nil
    }
}
