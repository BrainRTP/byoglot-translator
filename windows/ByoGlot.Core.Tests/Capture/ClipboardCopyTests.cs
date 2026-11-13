using ByoGlot.Core.Capture;

namespace ByoGlot.Core.Tests.Capture;

public class ClipboardCopyTests
{
    private sealed class Snapshot : IClipboardSnapshot
    {
        public void Dispose() { }
    }
    private sealed class Backend : IClipboardCopyBackend
    {
        public uint Sequence { get; set; } = 1;
        public bool IsExcluded { get; set; }
        public bool CopySucceeds { get; init; } = true;
        public bool CopyChanges { get; init; } = true;
        public bool NewerDuringRead { get; init; }
        public bool ChangesDuringSnapshot { get; init; }
        public bool SnapshotAvailable { get; init; } = true;
        public bool ReadThrows { get; init; }
        public int Snapshots { get; private set; }
        public int Copies { get; private set; }
        public int Reads { get; private set; }
        public int Restores { get; private set; }
        public IClipboardSnapshot? Snapshot() { Snapshots++; if (ChangesDuringSnapshot) Sequence++; return SnapshotAvailable ? new Snapshot() : null; }
        public bool TryCopy() { Copies++; return CopySucceeds; }
        public Task WaitForChangeAsync(uint previous) { if (CopyChanges) Sequence++; return Task.CompletedTask; }
        public ClipboardRead ReadChanged(uint previous, uint current)
        {
            if (previous == current) return new ClipboardRead.Empty();
            Reads++;
            if (NewerDuringRead) Sequence++;
            if (ReadThrows) throw new IOException();
            return new ClipboardRead.Text("selection");
        }
        public Task RestoreAsync(IClipboardSnapshot snapshot, uint expectedSequence) { Assert.Equal(Sequence, expectedSequence); Restores++; return Task.CompletedTask; }
    }
    [Fact] public async Task ExcludedClipboardIsNeverSnapshottedOrCopied()
    {
        var backend = new Backend { IsExcluded = true };
        Assert.IsType<ClipboardRead.Concealed>(await ClipboardCopy.RunAsync(backend));
        Assert.Equal((0, 0, 0, 0), (backend.Snapshots, backend.Copies, backend.Reads, backend.Restores));
    }
    [Fact] public async Task UnchangedClipboardIsNeverRestored()
    {
        var backend = new Backend { CopyChanges = false };
        Assert.IsType<ClipboardRead.Empty>(await ClipboardCopy.RunAsync(backend));
        Assert.Equal((0, 0), (backend.Reads, backend.Restores));
    }
    [Fact] public async Task NewerClipboardIsNeverOverwritten()
    {
        var backend = new Backend { NewerDuringRead = true };
        await ClipboardCopy.RunAsync(backend);
        Assert.Equal(0, backend.Restores);
    }
    [Fact] public async Task ChangedCopyRestoresItsSnapshot()
    {
        var backend = new Backend();
        Assert.IsType<ClipboardRead.Text>(await ClipboardCopy.RunAsync(backend));
        Assert.Equal(1, backend.Restores);
    }
    [Fact] public async Task ReadFailureStillRestoresTheSnapshot()
    {
        var backend = new Backend { ReadThrows = true };
        await Assert.ThrowsAsync<IOException>(() => ClipboardCopy.RunAsync(backend));
        Assert.Equal(1, backend.Restores);
    }
    [Fact] public async Task IncompleteSnapshotPreventsTheSimulatedCopy()
    {
        var backend = new Backend { SnapshotAvailable = false };
        await ClipboardCopy.RunAsync(backend);
        Assert.Equal(0, backend.Copies);
    }
    [Fact] public async Task ClipboardChangedDuringSnapshotPreventsTheSimulatedCopy()
    {
        var backend = new Backend { ChangesDuringSnapshot = true };
        await ClipboardCopy.RunAsync(backend);
        Assert.Equal(0, backend.Copies);
    }
}
