using ByoGlot.Core.Capture;

namespace ByoGlot.Core.Tests.Capture;

public class DoubleCopyDetectorTests
{
    private static TimeSpan Ms(int time) => TimeSpan.FromMilliseconds(time);
    [Fact]
    public void OneUpdateDoesNotFire() => Assert.False(new DoubleCopyDetector().Observe(1, Ms(0)));
    [Fact]
    public void TwoUpdatesInsideTheWindowFire()
    {
        var detector = new DoubleCopyDetector();
        Assert.False(detector.Observe(1, Ms(0)));
        Assert.True(detector.Observe(2, Ms(200)));
    }
    [Fact]
    public void TwoUpdatesTooCloseAreOneCopy()
    {
        var detector = new DoubleCopyDetector();
        Assert.False(detector.Observe(1, Ms(0)));
        Assert.False(detector.Observe(2, Ms(30)));
        Assert.False(detector.Observe(3, Ms(60)));
        Assert.False(detector.Observe(4, Ms(130)));
    }
    [Fact]
    public void TwoUpdatesOutsideTheWindowDoNotFire()
    {
        var detector = new DoubleCopyDetector();
        Assert.False(detector.Observe(1, Ms(0)));
        Assert.False(detector.Observe(2, Ms(700)));
        Assert.True(detector.Observe(3, Ms(900)));
    }
    [Fact]
    public void AThirdQuickUpdateDoesNotFireAgain()
    {
        var detector = new DoubleCopyDetector();
        Assert.False(detector.Observe(1, Ms(0)));
        Assert.True(detector.Observe(2, Ms(200)));
        Assert.False(detector.Observe(3, Ms(230)));
    }
    [Fact]
    public void TheSameSequenceNumberIsIgnored()
    {
        var detector = new DoubleCopyDetector();
        Assert.False(detector.Observe(1, Ms(0)));
        Assert.False(detector.Observe(1, Ms(200)));
        Assert.True(detector.Observe(2, Ms(300)));
    }
}
