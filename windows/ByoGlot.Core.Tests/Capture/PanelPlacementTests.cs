using ByoGlot.Core.Capture;

namespace ByoGlot.Core.Tests.Capture;

public class PanelPlacementTests
{
    [Fact]
    public void PlacesBelowRightOfTheCursor() => Assert.Equal(new Rect(512, 512, 380, 240), PanelPlacement.Frame(500, 500, 380, 240, new(0, 0, 1920, 1040)));
    [Fact]
    public void MovesLeftAtTheRightEdge() => Assert.Equal(new Rect(1532, 512, 380, 240), PanelPlacement.Frame(1900, 500, 380, 240, new(0, 0, 1920, 1040)));
    [Fact]
    public void FlipsAboveAtTheBottomEdge() => Assert.Equal(new Rect(512, 748, 380, 240), PanelPlacement.Frame(500, 1000, 380, 240, new(0, 0, 1920, 1040)));
    [Fact]
    public void WorksOnAMonitorWithNegativeOrigin() => Assert.Equal(new Rect(-388, 512, 380, 240), PanelPlacement.Frame(-10, 500, 380, 240, new(-1920, 0, 1920, 1040)));
    [Fact]
    public void ScaledPanelRemainsInsideTheMonitorWorkArea()
    {
        var work = new Rect(1920, -300, 2560, 1400);
        var frame = PanelPlacement.Frame(4479, 1099, 570, 360, work);
        Assert.Equal(new Rect(3902, 727, 570, 360), frame);
    }
}
