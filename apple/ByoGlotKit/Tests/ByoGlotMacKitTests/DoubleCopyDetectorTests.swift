#if os(macOS)
import ByoGlotMacKit
import Testing

struct DoubleCopyDetectorTests {
    @Test func otherModifiersClearRecentCommandAndPendingCopy() {
        var detector = DoubleCopyDetector()
        let start = ContinuousClock.now
        #expect(detector.observe(changeCount: 10, commandPressed: true, otherModifiersPressed: false, at: start) == false)
        #expect(detector.observe(changeCount: 11, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(100)) == false)
        #expect(detector.observe(changeCount: 11, commandPressed: true, otherModifiersPressed: true, at: start + .milliseconds(150)) == false)
        #expect(detector.observe(changeCount: 12, commandPressed: false, otherModifiersPressed: false, at: start + .milliseconds(200)) == false)
        #expect(detector.observe(changeCount: 13, commandPressed: false, otherModifiersPressed: false, at: start + .milliseconds(300)) == false)
        #expect(detector.observe(changeCount: 14, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(400)) == false)
        #expect(detector.observe(changeCount: 15, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(500)) == true)
    }

    @Test func onlyChangesNearCommandCanTrigger() {
        var detector = DoubleCopyDetector()
        let start = ContinuousClock.now
        #expect(detector.observe(changeCount: 10, commandPressed: false, otherModifiersPressed: false, at: start) == false)
        #expect(detector.observe(changeCount: 11, commandPressed: false, otherModifiersPressed: false, at: start + .milliseconds(100)) == false)
        #expect(detector.observe(changeCount: 12, commandPressed: false, otherModifiersPressed: false, at: start + .milliseconds(200)) == false)
        #expect(detector.observe(changeCount: 12, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(300)) == false)
        #expect(detector.observe(changeCount: 13, commandPressed: false, otherModifiersPressed: false, at: start + .milliseconds(400)) == false)
        #expect(detector.observe(changeCount: 14, commandPressed: false, otherModifiersPressed: false, at: start + .milliseconds(500)) == true)
        #expect(detector.observe(changeCount: 15, commandPressed: false, otherModifiersPressed: false, at: start + .milliseconds(501)) == false)
        #expect(detector.observe(changeCount: 16, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(600)) == false)
        #expect(detector.observe(changeCount: 17, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(700)) == true)
    }

    @Test func oneChangeDoesNotFire() {
        var detector = DoubleCopyDetector()
        let start = ContinuousClock.now
        #expect(detector.observe(changeCount: 10, commandPressed: true, otherModifiersPressed: false, at: start) == false)
        #expect(detector.observe(changeCount: 11, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(100)) == false)
    }

    @Test func twoChangesInsideTheWindowFire() {
        for interval in [200, 500, 700] {
            var detector = DoubleCopyDetector()
            let start = ContinuousClock.now
            #expect(detector.observe(changeCount: 10, commandPressed: true, otherModifiersPressed: false, at: start) == false)
            #expect(detector.observe(changeCount: 11, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(100)) == false)
            #expect(detector.observe(changeCount: 12, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(100 + interval)) == true)
        }
    }

    @Test func twoChangesOutsideTheWindowDoNotFire() {
        var detector = DoubleCopyDetector()
        let start = ContinuousClock.now
        #expect(detector.observe(changeCount: 10, commandPressed: true, otherModifiersPressed: false, at: start) == false)
        #expect(detector.observe(changeCount: 11, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(100)) == false)
        #expect(detector.observe(changeCount: 12, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(900)) == false)
    }

    @Test func aThirdQuickChangeDoesNotFireAgain() {
        var detector = DoubleCopyDetector()
        let start = ContinuousClock.now
        #expect(detector.observe(changeCount: 10, commandPressed: true, otherModifiersPressed: false, at: start) == false)
        #expect(detector.observe(changeCount: 11, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(100)) == false)
        #expect(detector.observe(changeCount: 12, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(300)) == true)
        #expect(detector.observe(changeCount: 13, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(500)) == false)
    }

    @Test func theSameChangeCountTwiceIsIgnored() {
        var detector = DoubleCopyDetector()
        let start = ContinuousClock.now
        #expect(detector.observe(changeCount: 10, commandPressed: true, otherModifiersPressed: false, at: start) == false)
        #expect(detector.observe(changeCount: 11, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(100)) == false)
        #expect(detector.observe(changeCount: 11, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(500)) == false)
        #expect(detector.observe(changeCount: 12, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(900)) == false)
    }

    @Test func aNewPairAfterAQuietWindowFires() {
        var detector = DoubleCopyDetector(window: .milliseconds(300))
        let start = ContinuousClock.now
        #expect(detector.observe(changeCount: 10, commandPressed: true, otherModifiersPressed: false, at: start) == false)
        #expect(detector.observe(changeCount: 11, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(100)) == false)
        #expect(detector.observe(changeCount: 12, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(300)) == true)
        #expect(detector.observe(changeCount: 13, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(700)) == false)
        #expect(detector.observe(changeCount: 14, commandPressed: true, otherModifiersPressed: false, at: start + .milliseconds(900)) == true)
    }
}
#endif
