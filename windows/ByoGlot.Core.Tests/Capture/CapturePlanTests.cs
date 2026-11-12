using ByoGlot.Core.Capture;

namespace ByoGlot.Core.Tests.Capture;

public class CapturePlanTests
{
    [Fact]
    public async Task ElevatedForegroundIsReported() => Assert.IsType<CaptureResult.Elevated>(await CapturePlan.RunAsync(new(true, "automation", true, () => throw new InvalidOperationException("Must not copy elevated content."))));
    [Fact]
    public async Task AutomationTextWins() => Assert.Equal(new CaptureResult.Text("selection", SelectionSource.Automation), await CapturePlan.RunAsync(new(false, " selection ", true, () => throw new InvalidOperationException("Must not copy when automation works."))));
    [Fact]
    public async Task FallbackRunsOnlyWhenAllowed()
    {
        var calls = 0;
        Task<string?> Copy() { calls++; return Task.FromResult<string?>(" copied "); }
        Assert.IsType<CaptureResult.Nothing>(await CapturePlan.RunAsync(new(false, null, false, Copy)));
        Assert.Equal(0, calls);
        Assert.Equal(new CaptureResult.Text("copied", SelectionSource.CopyFallback), await CapturePlan.RunAsync(new(false, " ", true, Copy)));
        Assert.Equal(1, calls);
    }
    [Fact]
    public async Task BlankEverywhereIsNothing() => Assert.IsType<CaptureResult.Nothing>(await CapturePlan.RunAsync(new(false, " ", true, () => Task.FromResult<string?>(" \n"))));
}
