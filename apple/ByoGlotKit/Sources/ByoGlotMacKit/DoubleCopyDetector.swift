#if os(macOS)
public struct DoubleCopyDetector: Sendable {
    private let window: Duration
    private var lastCount: Int?
    private var lastChange: ContinuousClock.Instant?
    private var fired = false

    public init(window: Duration = .milliseconds(700)) {
        self.window = window
    }

    public mutating func observe(changeCount: Int, at time: ContinuousClock.Instant) -> Bool {
        // The first observation establishes the baseline before any copy.
        guard let lastCount else {
            self.lastCount = changeCount
            return false
        }
        guard changeCount != lastCount else { return false }
        self.lastCount = changeCount
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
