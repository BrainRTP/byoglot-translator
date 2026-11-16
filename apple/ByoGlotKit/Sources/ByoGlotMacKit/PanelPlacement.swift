#if os(macOS)
import Foundation

public enum PanelPlacement {
    public static func frame(mouse: CGPoint, size: CGSize, visibleFrame: CGRect) -> CGRect {
        let bounds = visibleFrame.insetBy(dx: 8, dy: 8)
        let size = CGSize(width: min(size.width, bounds.width), height: min(size.height, bounds.height))
        let below = mouse.y - 12 - size.height
        let y = below >= bounds.minY ? below : mouse.y + 12
        return CGRect(
            x: min(max(mouse.x + 12, bounds.minX), bounds.maxX - size.width),
            y: min(max(y, bounds.minY), bounds.maxY - size.height),
            width: size.width,
            height: size.height
        )
    }
}
#endif
