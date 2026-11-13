namespace ByoGlot.Core.Capture;

public enum SelectionSource { None, Automation, CopyFallback }
public sealed record CaptureInputs(bool ForegroundIsElevated, string? AutomationText, bool CopyFallbackAllowed, Func<Task<ClipboardRead>> CopyAndRead, bool AutomationAvailable = true)
{
    public override string ToString() => "CaptureInputs { [redacted] }";
}
public abstract record CaptureResult
{
    public sealed override string ToString() => $"{GetType().Name} {{ [redacted] }}";
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
        if (!inputs.AutomationAvailable) return new CaptureResult.Nothing();
        var automation = JsText.Trim(inputs.AutomationText ?? "");
        if (automation.Length > 0) return new CaptureResult.Text(automation, SelectionSource.Automation);
        if (inputs.CopyFallbackAllowed)
        {
            var read = await inputs.CopyAndRead();
            if (read is ClipboardRead.Text text)
            {
                var value = JsText.Trim(text.Value);
                if (value.Length > 0) return new CaptureResult.Text(value, SelectionSource.CopyFallback);
            }
            else if (read is not ClipboardRead.Empty) return new CaptureResult.Clipboard(read);
        }
        return new CaptureResult.Nothing();
    }
}
