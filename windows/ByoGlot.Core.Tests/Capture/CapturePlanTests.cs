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
        Task<ClipboardRead> Copy() { calls++; return Task.FromResult<ClipboardRead>(new ClipboardRead.Text(" copied ")); }
        Assert.IsType<CaptureResult.Nothing>(await CapturePlan.RunAsync(new(false, null, false, Copy)));
        Assert.Equal(0, calls);
        Assert.Equal(new CaptureResult.Text("copied", SelectionSource.CopyFallback), await CapturePlan.RunAsync(new(false, " ", true, Copy)));
        Assert.Equal(1, calls);
    }
    [Fact]
    public async Task BlankEverywhereIsNothing() => Assert.IsType<CaptureResult.Nothing>(await CapturePlan.RunAsync(new(false, " ", true, () => Task.FromResult<ClipboardRead>(new ClipboardRead.Empty()))));
    [Theory]
    [InlineData(true, "Quick_Private")]
    [InlineData(false, "Quick_TooLong")]
    public async Task FallbackPreservesClipboardPrivacyAndLengthResults(bool concealed, string key)
    {
        ClipboardRead read = concealed ? new ClipboardRead.Concealed() : new ClipboardRead.TooLong(5000);
        var result = await CapturePlan.RunAsync(new(false, null, true, () => Task.FromResult(read)));
        Assert.Equal(read, Assert.IsType<CaptureResult.Clipboard>(result).Read);
        Assert.Equal(new QuickState.Message(key), QuickReducer.Reduce(new QuickState.Hidden(), new QuickEvent.Captured(result, 1)).State);
    }

    [Fact]
    public async Task CaptureWhitespaceMatchesJavaScript()
    {
        Assert.IsType<CaptureResult.Nothing>(await CapturePlan.RunAsync(new(false, "\uFEFF", true, () => Task.FromResult<ClipboardRead>(new ClipboardRead.Text("\uFEFF")))));
        Assert.Equal(new CaptureResult.Text("\u0085", SelectionSource.Automation), await CapturePlan.RunAsync(new(false, "\u0085", true, () => throw new InvalidOperationException("Automation text must win."))));
    }

}
