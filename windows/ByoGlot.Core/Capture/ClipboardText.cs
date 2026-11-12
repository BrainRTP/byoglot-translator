namespace ByoGlot.Core.Capture;

public abstract record ClipboardRead
{
    public sealed record Text(string Value) : ClipboardRead;
    public sealed record Empty : ClipboardRead;
    public sealed record Concealed : ClipboardRead;
    public sealed record TooLong(int Limit) : ClipboardRead;
}

public static class ClipboardText
{
    public static ClipboardRead ReadChanged(uint previousSequence, uint currentSequence, IReadOnlyCollection<string> formatNames, int limit, Func<string?> text)
        => previousSequence == currentSequence ? new ClipboardRead.Empty() : Read(formatNames, limit, text);

    public static ClipboardRead Read(IReadOnlyCollection<string> formatNames, int limit, Func<string?> text)
    {
        if (formatNames.Contains("ExcludeClipboardContentFromMonitorProcessing") || formatNames.Contains("CanIncludeInClipboardHistory")) return new ClipboardRead.Concealed();
        if (!formatNames.Any(f => f is "Text" or "UnicodeText" or "CF_TEXT" or "CF_UNICODETEXT")) return new ClipboardRead.Empty();
        var value = text() is { } raw ? JsText.Trim(raw) : null;
        if (string.IsNullOrEmpty(value)) return new ClipboardRead.Empty();
        return value.Length > limit ? new ClipboardRead.TooLong(limit) : new ClipboardRead.Text(value);
    }
}
