#if os(macOS)
import ByoGlotMacKit
import Testing

struct DoubleCopyDetectorTests {
    @Test func oneChangeDoesNotFire() {
        var detector = DoubleCopyDetector()
        let start = ContinuousClock.now
        #expect(detector.observe(changeCount: 10, at: start) == false)
        #expect(detector.observe(changeCount: 11, at: start + .milliseconds(100)) == false)
    }

    @Test func twoChangesInsideTheWindowFire() {
        for interval in [200, 500, 700] {
            var detector = DoubleCopyDetector()
            let start = ContinuousClock.now
            #expect(detector.observe(changeCount: 10, at: start) == false)
            #expect(detector.observe(changeCount: 11, at: start + .milliseconds(100)) == false)
            #expect(detector.observe(changeCount: 12, at: start + .milliseconds(100 + interval)) == true)
        }
    }

    @Test func twoChangesOutsideTheWindowDoNotFire() {
        var detector = DoubleCopyDetector()
        let start = ContinuousClock.now
        #expect(detector.observe(changeCount: 10, at: start) == false)
        #expect(detector.observe(changeCount: 11, at: start + .milliseconds(100)) == false)
        #expect(detector.observe(changeCount: 12, at: start + .milliseconds(900)) == false)
    }

    @Test func aThirdQuickChangeDoesNotFireAgain() {
        var detector = DoubleCopyDetector()
        let start = ContinuousClock.now
        #expect(detector.observe(changeCount: 10, at: start) == false)
        #expect(detector.observe(changeCount: 11, at: start + .milliseconds(100)) == false)
        #expect(detector.observe(changeCount: 12, at: start + .milliseconds(300)) == true)
        #expect(detector.observe(changeCount: 13, at: start + .milliseconds(500)) == false)
    }

    @Test func theSameChangeCountTwiceIsIgnored() {
        var detector = DoubleCopyDetector()
        let start = ContinuousClock.now
        #expect(detector.observe(changeCount: 10, at: start) == false)
        #expect(detector.observe(changeCount: 11, at: start + .milliseconds(100)) == false)
        #expect(detector.observe(changeCount: 11, at: start + .milliseconds(500)) == false)
        #expect(detector.observe(changeCount: 12, at: start + .milliseconds(900)) == false)
    }

    @Test func aNewPairAfterAQuietWindowFires() {
        var detector = DoubleCopyDetector(window: .milliseconds(300))
        let start = ContinuousClock.now
        #expect(detector.observe(changeCount: 10, at: start) == false)
        #expect(detector.observe(changeCount: 11, at: start + .milliseconds(100)) == false)
        #expect(detector.observe(changeCount: 12, at: start + .milliseconds(300)) == true)
        #expect(detector.observe(changeCount: 13, at: start + .milliseconds(700)) == false)
        #expect(detector.observe(changeCount: 14, at: start + .milliseconds(900)) == true)
    }
}
#endif
