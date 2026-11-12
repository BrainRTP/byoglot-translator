namespace ByoGlot.Core.Capture;

public enum SelectionSource { None, Automation, CopyFallback }
public sealed record CaptureInputs(bool ForegroundIsElevated, string? AutomationText, bool CopyFallbackAllowed, Func<Task<ClipboardRead>> CopyAndRead);
public abstract record CaptureResult
{
    public sealed record Text(string Value, SelectionSource Source) : CaptureResult;
    public sealed record Elevated : CaptureResult;
    public sealed record Nothing : CaptureResult;
    public sealed record Clipboard(ClipboardRead Read) : CaptureResult;
}

public static class CapturePlan
{
    public static async Task<CaptureResult> RunAsync(CaptureInputs inputs)
    {
        if (inputs.ForegroundIsElevated) return new CaptureResult.Elevated();
        if (!string.IsNullOrWhiteSpace(inputs.AutomationText)) return new CaptureResult.Text(inputs.AutomationText.Trim(), SelectionSource.Automation);
        if (inputs.CopyFallbackAllowed)
        {
            var read = await inputs.CopyAndRead();
            if (read is ClipboardRead.Text text)
            {
                if (!string.IsNullOrWhiteSpace(text.Value)) return new CaptureResult.Text(text.Value.Trim(), SelectionSource.CopyFallback);
            }
            else if (read is not ClipboardRead.Empty) return new CaptureResult.Clipboard(read);
        }
        return new CaptureResult.Nothing();
    }
}
