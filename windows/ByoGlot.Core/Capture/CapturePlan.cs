namespace ByoGlot.Core.Capture;

public enum SelectionSource { None, Automation, CopyFallback }
public sealed record CaptureInputs(bool ForegroundIsElevated, string? AutomationText, bool CopyFallbackAllowed, Func<Task<string?>> CopyAndRead);
public abstract record CaptureResult
{
    public sealed record Text(string Value, SelectionSource Source) : CaptureResult;
    public sealed record Elevated : CaptureResult;
    public sealed record Nothing : CaptureResult;
}

public static class CapturePlan
{
    public static async Task<CaptureResult> RunAsync(CaptureInputs inputs)
    {
        if (inputs.ForegroundIsElevated) return new CaptureResult.Elevated();
        if (!string.IsNullOrWhiteSpace(inputs.AutomationText)) return new CaptureResult.Text(inputs.AutomationText.Trim(), SelectionSource.Automation);
        if (inputs.CopyFallbackAllowed)
        {
            var text = await inputs.CopyAndRead();
            if (!string.IsNullOrWhiteSpace(text)) return new CaptureResult.Text(text.Trim(), SelectionSource.CopyFallback);
        }
        return new CaptureResult.Nothing();
    }
}
