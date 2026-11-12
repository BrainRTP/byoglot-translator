using ByoGlot.Core.Capture;

namespace ByoGlot.Core.Tests.Capture;

public class QuickStateTests
{
    private static readonly RunnerOutput Output = new("translated", "en", "ru", new("deepseek", "deepseek-flash"));
    [Fact]
    public void CapturedTextStartsATranslation()
    {
        var reduced = QuickReducer.Reduce(new QuickState.Hidden(), new QuickEvent.Captured(new CaptureResult.Text("hello", SelectionSource.Automation)));
        Assert.Equal(new QuickState.Translating("hello"), reduced.State);
        Assert.Equal("hello", reduced.StartTranslating);
        var done = QuickReducer.Reduce(reduced.State, new QuickEvent.Finished(Output));
        Assert.Equal(new QuickState.Done("hello", Output), done.State);
        Assert.Null(done.StartTranslating);
    }
    [Fact]
    public void ANewTriggerWhileTranslatingRestarts()
    {
        var reduced = QuickReducer.Reduce(new QuickState.Translating("old"), new QuickEvent.Clipboard(new ClipboardRead.Text("new")));
        Assert.Equal(new QuickState.Translating("new"), reduced.State);
        Assert.Equal("new", reduced.StartTranslating);
    }
    [Fact]
    public void MessagesStartNothing()
    {
        (QuickEvent Event, string Key)[] events =
        [
            (new QuickEvent.Captured(new CaptureResult.Elevated()), "Quick_Elevated"),
            (new QuickEvent.Captured(new CaptureResult.Nothing()), "Quick_NoText"),
            (new QuickEvent.Clipboard(new ClipboardRead.Empty()), "Quick_NoText"),
            (new QuickEvent.Clipboard(new ClipboardRead.Concealed()), "Quick_Private"),
            (new QuickEvent.Clipboard(new ClipboardRead.TooLong(5000)), "Quick_TooLong")
        ];
        foreach (var (e, key) in events)
        {
            var reduced = QuickReducer.Reduce(new QuickState.Translating("old"), e);
            Assert.Equal(new QuickState.Message(key), reduced.State);
            Assert.Null(reduced.StartTranslating);
        }
    }
    [Fact]
    public void ALateResultAfterDismissIsIgnored()
    {
        var state = QuickReducer.Reduce(new QuickState.Translating("hello"), new QuickEvent.Dismissed()).State;
        Assert.IsType<QuickState.Hidden>(state);
        Assert.Same(state, QuickReducer.Reduce(state, new QuickEvent.Finished(Output)).State);
        Assert.Same(state, QuickReducer.Reduce(state, new QuickEvent.FailedWith(new RunnerError.NoConnection())).State);
    }
    [Fact]
    public void FailureAppliesOnlyWhileTranslating()
    {
        var error = new RunnerError.NoConnection();
        Assert.Equal(new QuickState.Failed("hello", error), QuickReducer.Reduce(new QuickState.Translating("hello"), new QuickEvent.FailedWith(error)).State);
    }
}
