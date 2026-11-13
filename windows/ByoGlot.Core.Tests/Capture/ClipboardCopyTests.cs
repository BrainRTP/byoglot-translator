using ByoGlot.Core.Capture;

namespace ByoGlot.Core.Tests.Capture;

public class ClipboardCopyTests
{
    private sealed class Snapshot : IClipboardSnapshot
    {
        public TaskCompletionSource Disposed { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public void Dispose() => Disposed.TrySetResult();
    }
    private sealed class Backend : IClipboardCopyBackend
    {
        private readonly List<(int At, Action<Backend> Change)> events = [];
        private int next;
        private int copyStart;
        public int Time { get; private set; }
        public uint Sequence { get; private set; } = 1;
        public long Owner { get; private set; } = 10;
        public uint Process { get; private set; } = 10;
        public string Fingerprint { get; private set; } = "original";
        public bool CanOpen { get; private set; } = true;
        public uint SourceProcessId => 20;
        public ClipboardVersion Current => new(Sequence, Owner, Process, CanOpen);
        public ClipboardIdentity Identity => new(Owner, Process, Fingerprint);
        public bool Protected { get; init; }
        public bool HistoryExcluded { get; set; }
        public bool TrustedMarker { get; set; }
        public ClipboardOwnWrites OwnWrites { get; } = new();
        public bool IsExcluded => OwnWrites.IsExcluded(Sequence, Owner, TrustedMarker, Protected ? ["ExcludeClipboardContentFromMonitorProcessing"] : HistoryExcluded ? ["CanIncludeInClipboardHistory"] : []);
        public bool SnapshotAvailable { get; init; } = true;
        public bool RenderDuringSnapshot { get; init; }
        public bool UserCopyDuringSnapshot { get; init; }
        public bool RenderDuringRead { get; init; }
        public bool RestoreFails { get; init; }
        public TaskCompletionSource<ClipboardBackup?>? HungSnapshot { get; init; }
        public int Snapshots { get; private set; }
        public int Copies { get; private set; }
        public int Restores { get; private set; }
        public List<int> ReadTimes { get; } = [];
        public void At(int milliseconds, Action<Backend> change) => events.Add((milliseconds, change));
        public void Copy(string content = "selection", long owner = 20, uint process = 20, bool canOpen = true)
        {
            Sequence++; Owner = owner; Process = process; Fingerprint = content; CanOpen = canOpen; TrustedMarker = false; HistoryExcluded = false;
        }
        public void AddFormat() => Sequence++;
        public void Open() => CanOpen = true;
        public void MarkOwn()
        {
            Owner = 30; Process = 30; HistoryExcluded = true;
            OwnWrites.Ignore(Sequence, Owner);
        }
        public Task<ClipboardBackup?> SnapshotAsync(CancellationToken cancellation)
        {
            Snapshots++;
            if (HungSnapshot is not null) return HungSnapshot.Task;
            var identity = Identity;
            if (RenderDuringSnapshot) Sequence++;
            if (UserCopyDuringSnapshot) Copy("user", 99, 99);
            return Task.FromResult(SnapshotAvailable ? new ClipboardBackup(new Snapshot(), identity) : null);
        }
        public Task<ClipboardContent?> ReadAsync(CancellationToken cancellation)
        {
            if (!CanOpen) return Task.FromResult<ClipboardContent?>(null);
            if (Copies > 0)
            {
                ReadTimes.Add(Time);
                if (RenderDuringRead) Sequence++;
            }
            return Task.FromResult<ClipboardContent?>(new(Current, Identity, new ClipboardRead.Text(Fingerprint)));
        }
        public bool TryCopy() { Copies++; copyStart = Time; next = 0; return true; }
        public Task DelayAsync(int milliseconds)
        {
            Time += milliseconds;
            while (next < events.Count && events[next].At <= Time - copyStart) events[next++].Change(this);
            return Task.CompletedTask;
        }
        public Task<ClipboardRestoreResult> RestoreAsync(IClipboardSnapshot snapshot, ClipboardIdentity expected, CancellationToken cancellation)
        {
            if (!ClipboardCopy.Matches(expected, Identity)) return Task.FromResult(ClipboardRestoreResult.Superseded);
            if (RestoreFails) return Task.FromResult(ClipboardRestoreResult.Failed);
            Restores++; Fingerprint = "original"; Sequence++; MarkOwn();
            return Task.FromResult(ClipboardRestoreResult.Restored);
        }
    }
    [Fact] public async Task ProtectedClipboardIsNeverSnapshottedOrCopied()
    {
        var backend = new Backend { Protected = true };
        Assert.IsType<ClipboardRead.Concealed>(await ClipboardCopy.RunAsync(backend));
        Assert.Equal((0, 0, 0), (backend.Snapshots, backend.Copies, backend.Restores));
    }
    [Fact] public async Task UnchangedClipboardIsNeverRestored()
    {
        var backend = new Backend();
        Assert.IsType<ClipboardRead.Empty>(await ClipboardCopy.RunAsync(backend));
        Assert.Empty(backend.ReadTimes);
        Assert.Equal(0, backend.Restores);
    }
    [Fact] public async Task MultipleFormatBumpsSettleBeforeReadingAndRestoring()
    {
        var backend = new Backend();
        backend.At(10, b => b.Copy(canOpen: false));
        backend.At(40, b => b.AddFormat());
        backend.At(70, b => b.Open());
        backend.At(110, b => b.AddFormat());
        backend.At(240, b => b.AddFormat());
        Assert.IsType<ClipboardRead.Text>(await ClipboardCopy.RunAsync(backend));
        Assert.True(backend.ReadTimes[0] >= 210);
        Assert.Equal(1, backend.Restores);
        Assert.Equal("original", backend.Fingerprint);
    }
    [Fact] public async Task ACopyAfterTheOld400MillisecondDeadlineIsRestored()
    {
        var backend = new Backend();
        backend.At(700, b => b.Copy());
        Assert.IsType<ClipboardRead.Text>(await ClipboardCopy.RunAsync(backend));
        Assert.True(backend.ReadTimes[0] >= 800);
        Assert.Equal(1, backend.Restores);
    }
    [Fact] public async Task ReadingWaitsUntilTheOwnerClosesTheClipboard()
    {
        var backend = new Backend();
        backend.At(10, b => b.Copy(canOpen: false));
        backend.At(250, b => b.Open());
        Assert.IsType<ClipboardRead.Text>(await ClipboardCopy.RunAsync(backend));
        Assert.True(backend.ReadTimes[0] >= 350);
        Assert.Equal(1, backend.Restores);
    }
    [Fact] public async Task RenderingDuringTheReadDoesNotPreventRestoration()
    {
        var backend = new Backend { RenderDuringRead = true };
        backend.At(10, b => b.Copy());
        backend.At(150, b => b.AddFormat());
        await ClipboardCopy.RunAsync(backend);
        Assert.Equal(1, backend.Restores);
    }
    [Theory]
    [InlineData(20, 20)]
    [InlineData(99, 99)]
    public async Task AUserCopyAfterSettleWinsEvenInTheSameProcess(long owner, uint process)
    {
        var backend = new Backend();
        backend.At(10, b => b.Copy());
        backend.At(170, b => b.Copy("user copy", owner, process));
        await ClipboardCopy.RunAsync(backend);
        Assert.Equal(0, backend.Restores);
        Assert.Equal("user copy", backend.Fingerprint);
    }
    [Fact] public async Task RenderingTheOldSnapshotDoesNotPreventTheCopy()
    {
        var backend = new Backend { RenderDuringSnapshot = true };
        backend.At(10, b => b.Copy());
        await ClipboardCopy.RunAsync(backend);
        Assert.Equal((1, 1), (backend.Copies, backend.Restores));
    }
    [Fact] public async Task AUserCopyDuringTheSnapshotPreventsSimulatedCopy()
    {
        var backend = new Backend { UserCopyDuringSnapshot = true };
        await ClipboardCopy.RunAsync(backend);
        Assert.Equal(0, backend.Copies);
    }
    [Fact] public async Task OurIgnoredWriteIsRecognizedBeforeHistoryExclusion()
    {
        var backend = new Backend();
        backend.MarkOwn();
        backend.At(10, b => b.Copy());
        Assert.IsType<ClipboardRead.Text>(await ClipboardCopy.RunAsync(backend));
        Assert.Equal(1, backend.Restores);
        Assert.False(backend.IsExcluded);
        Assert.IsType<ClipboardRead.Text>(await ClipboardCopy.RunAsync(backend));
        Assert.Equal(2, backend.Restores);
    }
    [Fact] public void OurMarkerDoesNotOverrideThePasswordManagerExclusion()
    {
        var own = new ClipboardOwnWrites();
        own.Ignore(1, 30);
        Assert.True(own.IsExcluded(1, 30, true, ["ExcludeClipboardContentFromMonitorProcessing"]));
        Assert.False(own.IsExcluded(2, 30, true, ["CanIncludeInClipboardHistory"]));
    }
    [Fact] public async Task RestoreFailureIsAVisibleTypedResult()
    {
        var backend = new Backend { RestoreFails = true };
        backend.At(10, b => b.Copy());
        Assert.IsType<ClipboardRead.RestoreFailed>(await ClipboardCopy.RunAsync(backend));
    }
    [Fact] public async Task AnIncompleteSnapshotNeverSendsCopy()
    {
        var backend = new Backend { SnapshotAvailable = false };
        await ClipboardCopy.RunAsync(backend);
        Assert.Equal(0, backend.Copies);
    }
    [Fact] public async Task AHungSnapshotTimesOutAndItsLateResultIsDisposed()
    {
        var pending = new TaskCompletionSource<ClipboardBackup?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var backend = new Backend { HungSnapshot = pending };
        Assert.IsType<ClipboardRead.Empty>(await ClipboardCopy.RunAsync(backend));
        Assert.Equal(0, backend.Copies);
        var snapshot = new Snapshot();
        pending.SetResult(new(snapshot, backend.Identity));
        await snapshot.Disposed.Task.WaitAsync(TimeSpan.FromSeconds(1), TestContext.Current.CancellationToken);
    }
}
