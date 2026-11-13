namespace ByoGlot.Core.Capture;

public abstract record QuickState
{
    public sealed record Hidden : QuickState;
    public sealed record Message(string ResourceKey) : QuickState;
    public sealed record Translating(string Source, long RequestId) : QuickState;
    public sealed record Done(string Source, RunnerOutput Result) : QuickState;
    public sealed record Failed(string Source, RunnerError Error) : QuickState;
}
public abstract record QuickEvent
{
    public sealed record Captured(CaptureResult Result, long RequestId) : QuickEvent;
    public sealed record Clipboard(ClipboardRead Read, long RequestId) : QuickEvent;
    public sealed record Finished(RunnerOutput Output, long RequestId) : QuickEvent;
    public sealed record FailedWith(RunnerError Error, long RequestId) : QuickEvent;
    public sealed record Dismissed : QuickEvent;
}

public static class QuickReducer
{
    public static (QuickState State, string? StartTranslating) Reduce(QuickState state, QuickEvent e) => e switch
    {
        QuickEvent.Captured { Result: CaptureResult.Text text } captured => (new QuickState.Translating(text.Value, captured.RequestId), text.Value),
        QuickEvent.Clipboard { Read: ClipboardRead.Text text } clipboard => (new QuickState.Translating(text.Value, clipboard.RequestId), text.Value),
        QuickEvent.Captured { Result: CaptureResult.Clipboard clipboard } captured => Reduce(state, new QuickEvent.Clipboard(clipboard.Read, captured.RequestId)),
        QuickEvent.Captured { Result: CaptureResult.Elevated } => (new QuickState.Message("Quick_Elevated"), null),
        QuickEvent.Captured { Result: CaptureResult.Nothing } or QuickEvent.Clipboard { Read: ClipboardRead.Empty } => (new QuickState.Message("Quick_NoText"), null),
        QuickEvent.Clipboard { Read: ClipboardRead.Concealed } => (new QuickState.Message("Quick_Private"), null),
        QuickEvent.Clipboard { Read: ClipboardRead.TooLong } => (new QuickState.Message("Quick_TooLong"), null),
        QuickEvent.Finished finished when state is QuickState.Translating translating && finished.RequestId == translating.RequestId => (new QuickState.Done(translating.Source, finished.Output), null),
        QuickEvent.FailedWith failed when state is QuickState.Translating translating && failed.RequestId == translating.RequestId => (new QuickState.Failed(translating.Source, failed.Error), null),
        QuickEvent.Dismissed => (new QuickState.Hidden(), null),
        _ => (state, null)
    };
}
