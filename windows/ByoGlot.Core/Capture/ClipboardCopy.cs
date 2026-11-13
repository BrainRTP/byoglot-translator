namespace ByoGlot.Core.Capture;

public interface IClipboardSnapshot : IDisposable;
public sealed record ClipboardVersion(uint Sequence, long Owner, uint ProcessId, bool CanOpen);
public sealed record ClipboardIdentity(long Owner, uint ProcessId, string Fingerprint)
{
    public override string ToString() => "ClipboardIdentity { [redacted] }";
}
public sealed record ClipboardContent(ClipboardVersion Version, ClipboardIdentity Identity, ClipboardRead Read);
public sealed record ClipboardBackup(IClipboardSnapshot Snapshot, ClipboardIdentity Identity);
public enum ClipboardRestoreResult { Restored, Superseded, Failed }

public interface IClipboardCopyBackend
{
    uint SourceProcessId { get; }
    ClipboardVersion Current { get; }
    bool IsExcluded { get; }
    Task<ClipboardBackup?> SnapshotAsync(CancellationToken cancellation);
    Task<ClipboardContent?> ReadAsync(CancellationToken cancellation);
    bool TryCopy();
    Task DelayAsync(int milliseconds);
    Task<ClipboardRestoreResult> RestoreAsync(IClipboardSnapshot snapshot, ClipboardIdentity expected, CancellationToken cancellation);
}

public static class ClipboardCopy
{
    public const int QuietMs = 100;
    public const int CopyWaitMs = 1400;
    public const int OperationTimeoutMs = 500;
    private const int PollMs = 10;

    public static bool Matches(ClipboardIdentity expected, ClipboardIdentity current) => expected == current;

    public static async Task<ClipboardRead> RunAsync(IClipboardCopyBackend backend)
    {
        if (backend.IsExcluded) return new ClipboardRead.Concealed();
        using var snapshotCancellation = new CancellationTokenSource();
        var snapshotTask = backend.SnapshotAsync(snapshotCancellation.Token);
        ClipboardBackup? backup;
        try { backup = await snapshotTask.WaitAsync(TimeSpan.FromMilliseconds(OperationTimeoutMs)); }
        catch (TimeoutException)
        {
            snapshotCancellation.Cancel();
            _ = DisposeLateSnapshotAsync(snapshotTask);
            return new ClipboardRead.Empty();
        }
        if (backup is null) return new ClipboardRead.Empty();
        using var snapshot = backup.Snapshot;
        var original = await ReadAsync(backend);
        if (original is null || !Matches(backup.Identity, original.Identity)) return new ClipboardRead.Empty();
        if (backend.IsExcluded) return new ClipboardRead.Concealed();
        if (!backend.TryCopy()) return new ClipboardRead.Empty();

        var settled = await SettleAsync(backend, original.Version, CopyWaitMs, requireChange: true);
        if (settled is null)
        {
            var current = backend.Current;
            return current.Sequence != original.Version.Sequence && current.ProcessId == backend.SourceProcessId
                ? new ClipboardRead.RestoreFailed() : new ClipboardRead.Empty();
        }
        var captured = await ReadAsync(backend);
        if (captured is null) return new ClipboardRead.RestoreFailed();
        if (captured.Identity.ProcessId != backend.SourceProcessId || captured.Identity.Owner != settled.Owner) return new ClipboardRead.Empty();

        // Rendering caused by the read can add more formats to the same copy.
        await SettleAsync(backend, captured.Version, 400, requireChange: false);
        using var restoreCancellation = new CancellationTokenSource();
        ClipboardRestoreResult restored;
        try { restored = await backend.RestoreAsync(snapshot, captured.Identity, restoreCancellation.Token).WaitAsync(TimeSpan.FromMilliseconds(OperationTimeoutMs)); }
        catch (TimeoutException) { restoreCancellation.Cancel(); restored = ClipboardRestoreResult.Failed; }
        return restored == ClipboardRestoreResult.Failed ? new ClipboardRead.RestoreFailed() : captured.Read;
    }

    private static async Task<ClipboardVersion?> SettleAsync(IClipboardCopyBackend backend, ClipboardVersion previous, int budget, bool requireChange)
    {
        var last = backend.Current;
        var quiet = -PollMs;
        for (var elapsed = 0; elapsed <= budget; elapsed += PollMs)
        {
            var current = backend.Current;
            if (current.Sequence != previous.Sequence && current.ProcessId != 0 && current.ProcessId != backend.SourceProcessId) return null;
            var candidate = current.ProcessId == backend.SourceProcessId && current.Owner != 0 && current.CanOpen
                && (!requireChange || current.Sequence != previous.Sequence);
            quiet = candidate && last.CanOpen && current.Sequence == last.Sequence && current.Owner == last.Owner ? quiet + PollMs : 0;
            if (quiet >= QuietMs) return current;
            last = current;
            await backend.DelayAsync(PollMs);
        }
        return null;
    }

    private static async Task<ClipboardContent?> ReadAsync(IClipboardCopyBackend backend)
    {
        using var cancellation = new CancellationTokenSource();
        try { return await backend.ReadAsync(cancellation.Token).WaitAsync(TimeSpan.FromMilliseconds(OperationTimeoutMs)); }
        catch (TimeoutException) { cancellation.Cancel(); return null; }
    }
    private static async Task DisposeLateSnapshotAsync(Task<ClipboardBackup?> task)
    {
        try { (await task)?.Snapshot.Dispose(); }
        catch (Exception) { }
    }
}

public sealed class ClipboardOwnWrites
{
    private readonly object gate = new();
    private readonly Dictionary<uint, long> ignored = [];
    public void Ignore(uint sequence, long owner)
    {
        lock (gate)
        {
            if (ignored.Count >= 64) ignored.Clear();
            ignored[sequence] = owner;
        }
    }
    public bool IsOwn(uint sequence, long owner, bool trustedMarker)
    {
        lock (gate) return trustedMarker || ignored.TryGetValue(sequence, out var writtenOwner) && owner == writtenOwner;
    }
    public bool IsExcluded(uint sequence, long owner, bool trustedMarker, IReadOnlyCollection<string> formats)
    {
        var own = IsOwn(sequence, owner, trustedMarker);
        return formats.Contains("ExcludeClipboardContentFromMonitorProcessing") || !own && formats.Contains("CanIncludeInClipboardHistory");
    }
}
