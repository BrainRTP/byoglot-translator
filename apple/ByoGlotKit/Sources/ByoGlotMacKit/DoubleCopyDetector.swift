#if os(macOS)
public struct DoubleCopyDetector: Sendable {
    private let window: Duration
    private var lastCount: Int?
    private var lastChange: ContinuousClock.Instant?
    private var lastCommand: ContinuousClock.Instant?
    private var fired = false

    public init(window: Duration = .milliseconds(700)) {
        self.window = window
    }

    public mutating func observe(changeCount: Int, commandPressed: Bool, otherModifiersPressed: Bool, at time: ContinuousClock.Instant) -> Bool {
        if otherModifiersPressed {
            lastCommand = nil
            lastChange = nil
            fired = false
        } else if commandPressed { lastCommand = time }
        // The first observation establishes the baseline before any copy.
        guard let lastCount else {
            self.lastCount = changeCount
            return false
        }
        guard changeCount != lastCount else { return false }
        self.lastCount = changeCount
        // shortcut: Clipboard writes while Command is held can qualify, use an explicit shortcut if false triggers persist.
        guard let lastCommand, lastCommand.duration(to: time) >= .zero, lastCommand.duration(to: time) <= .milliseconds(200) else {
            lastChange = nil
            fired = false
            return false
        }
        defer { lastChange = time }
        guard let lastChange,
              lastChange.duration(to: time) >= .zero,
              lastChange.duration(to: time) <= window else {
            fired = false
            return false
        }
        guard !fired else { return false }
        fired = true
        return true
    }
}
#endif
