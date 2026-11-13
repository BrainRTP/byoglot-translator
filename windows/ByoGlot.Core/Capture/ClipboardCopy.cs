namespace ByoGlot.Core.Capture;

public interface IClipboardSnapshot : IDisposable;

public interface IClipboardCopyBackend
{
    uint Sequence { get; }
    bool IsExcluded { get; }
    IClipboardSnapshot? Snapshot();
    bool TryCopy();
    Task WaitForChangeAsync(uint previous);
    ClipboardRead ReadChanged(uint previous, uint current);
    Task RestoreAsync(IClipboardSnapshot snapshot, uint expectedSequence);
}

public static class ClipboardCopy
{
    public static bool ShouldRestore(uint previous, uint copied, uint current) => previous != copied && copied == current;

    public static async Task<ClipboardRead> RunAsync(IClipboardCopyBackend backend)
    {
        var previous = backend.Sequence;
        if (backend.IsExcluded) return new ClipboardRead.Concealed();
        using var snapshot = backend.Snapshot();
        if (snapshot is null || backend.Sequence != previous) return new ClipboardRead.Empty();
        if (backend.IsExcluded) return new ClipboardRead.Concealed();
        if (!backend.TryCopy()) return new ClipboardRead.Empty();
        uint copied = previous;
        try
        {
            await backend.WaitForChangeAsync(previous);
            copied = backend.Sequence;
            return backend.ReadChanged(previous, copied);
        }
        finally
        {
            if (ShouldRestore(previous, copied, backend.Sequence)) await backend.RestoreAsync(snapshot, copied);
        }
    }
}
