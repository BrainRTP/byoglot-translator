#if os(macOS)
import ByoGlotMacKit
import Foundation
import Testing

struct PanelPlacementTests {
    private let size = CGSize(width: 380, height: 240)
    private let screen = CGRect(x: 0, y: 0, width: 1440, height: 900)

    @Test func placesBelowRightOfTheMouse() {
        let frame = PanelPlacement.frame(mouse: CGPoint(x: 500, y: 500), size: size, visibleFrame: screen)
        #expect(frame == CGRect(x: 512, y: 248, width: 380, height: 240))
    }

    @Test func movesLeftAtTheRightEdge() {
        let frame = PanelPlacement.frame(mouse: CGPoint(x: 1430, y: 500), size: size, visibleFrame: screen)
        #expect(frame.maxX == 1432)
        #expect(frame.size == size)
    }

    @Test func movesAboveAtTheBottomEdge() {
        let mouse = CGPoint(x: 500, y: 100)
        let frame = PanelPlacement.frame(mouse: mouse, size: size, visibleFrame: screen)
        #expect(frame.minY == mouse.y + 12)
        #expect(frame.minY >= 8)
        #expect(screen.insetBy(dx: 8, dy: 8).contains(frame))
    }

    @Test func worksOnASecondScreenWithANegativeOrigin() {
        let screen = CGRect(x: -1920, y: 0, width: 1920, height: 1080)
        for mouse in [CGPoint(x: -1000, y: 500), CGPoint(x: -1, y: 1), CGPoint(x: -1920, y: 1080)] {
            let frame = PanelPlacement.frame(mouse: mouse, size: size, visibleFrame: screen)
            #expect(screen.insetBy(dx: 8, dy: 8).contains(frame))
            #expect(frame.size == size)
        }
    }

    @Test func aResizedPanelFitsOnASmallerScreen() {
        let frame = PanelPlacement.frame(mouse: CGPoint(x: 500, y: 500), size: CGSize(width: 2000, height: 1200), visibleFrame: screen)
        #expect(frame == screen.insetBy(dx: 8, dy: 8))
    }
}
#endif
