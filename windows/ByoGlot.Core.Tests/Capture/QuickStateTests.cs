using ByoGlot.Core.Capture;

namespace ByoGlot.Core.Tests.Capture;

public class QuickStateTests
{
    private static readonly RunnerOutput Output = new("translated", "en", "ru", new("deepseek", "deepseek-flash"));
    [Fact]
    public void CapturedTextStartsATranslation()
    {
        var reduced = QuickReducer.Reduce(new QuickState.Hidden(), new QuickEvent.Captured(new CaptureResult.Text("hello", SelectionSource.Automation), 1));
        Assert.Equal(new QuickState.Translating("hello", 1), reduced.State);
        Assert.Equal("hello", reduced.StartTranslating);
        var done = QuickReducer.Reduce(reduced.State, new QuickEvent.Finished(Output, 1));
        Assert.Equal(new QuickState.Done("hello", Output), done.State);
        Assert.Null(done.StartTranslating);
    }
    [Fact]
    public void ANewTriggerWhileTranslatingRestarts()
    {
        var reduced = QuickReducer.Reduce(new QuickState.Translating("old", 1), new QuickEvent.Clipboard(new ClipboardRead.Text("new"), 2));
        Assert.Equal(new QuickState.Translating("new", 2), reduced.State);
        Assert.Equal("new", reduced.StartTranslating);
    }
    [Fact]
    public void MessagesStartNothing()
    {
        (QuickEvent Event, string Key)[] events =
        [
            (new QuickEvent.Captured(new CaptureResult.Elevated(), 1), "Quick_Elevated"),
            (new QuickEvent.Captured(new CaptureResult.Nothing(), 1), "Quick_NoText"),
            (new QuickEvent.Clipboard(new ClipboardRead.Empty(), 1), "Quick_NoText"),
            (new QuickEvent.Clipboard(new ClipboardRead.Concealed(), 1), "Quick_Private"),
            (new QuickEvent.Clipboard(new ClipboardRead.TooLong(5000), 1), "Quick_TooLong"),
            (new QuickEvent.Captured(new CaptureResult.Clipboard(new ClipboardRead.Concealed()), 1), "Quick_Private"),
            (new QuickEvent.Captured(new CaptureResult.Clipboard(new ClipboardRead.TooLong(5000)), 1), "Quick_TooLong")
        ];
        foreach (var (e, key) in events)
        {
            var reduced = QuickReducer.Reduce(new QuickState.Translating("old", 0), e);
            Assert.Equal(new QuickState.Message(key), reduced.State);
            Assert.Null(reduced.StartTranslating);
        }
    }
    [Fact]
    public void ALateResultAfterDismissIsIgnored()
    {
        var state = QuickReducer.Reduce(new QuickState.Translating("hello", 1), new QuickEvent.Dismissed()).State;
        Assert.IsType<QuickState.Hidden>(state);
        Assert.Same(state, QuickReducer.Reduce(state, new QuickEvent.Finished(Output, 1)).State);
        Assert.Same(state, QuickReducer.Reduce(state, new QuickEvent.FailedWith(new RunnerError.NoConnection(), 1)).State);
    }
    [Fact]
    public void FailureAppliesOnlyWhileTranslating()
    {
        var error = new RunnerError.NoConnection();
        Assert.Equal(new QuickState.Failed("hello", error), QuickReducer.Reduce(new QuickState.Translating("hello", 1), new QuickEvent.FailedWith(error, 1)).State);
    }
    [Theory]
    [InlineData("new text")]
    [InlineData("same text")]
    public void QueuedCompletionFromAnOlderRequestIsIgnored(string newText)
    {
        var state = QuickReducer.Reduce(new QuickState.Translating("same text", 1), new QuickEvent.Captured(new CaptureResult.Text(newText, SelectionSource.Automation), 2)).State;
        Assert.Same(state, QuickReducer.Reduce(state, new QuickEvent.Finished(Output, 1)).State);
        Assert.Same(state, QuickReducer.Reduce(state, new QuickEvent.FailedWith(new RunnerError.NoConnection(), 1)).State);
        Assert.Equal(new QuickState.Done(newText, Output), QuickReducer.Reduce(state, new QuickEvent.Finished(Output, 2)).State);
    }
}
