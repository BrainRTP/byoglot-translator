using System.Diagnostics;
using ByoGlot.Core.Capture;
using Windows.Win32;
using Windows.Win32.Foundation;

namespace ByoGlot.App.Shell;

public sealed class ClipboardListener : IDisposable
{
    private readonly MessageWindow window;
    private readonly DoubleCopyDetector detector = new();
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private int ownWrites;
    private bool enabled;
    public event Action? DoubleCopied;
    internal HWND Handle => window.Handle;
    public ClipboardListener(MessageWindow window) { this.window = window; window.Message += OnMessage; }
    public void SetEnabled(bool value)
    {
        if (enabled == value) return;
        IgnoreOwnWrite();
        if (value) enabled = PInvoke.AddClipboardFormatListener(window.Handle);
        else { PInvoke.RemoveClipboardFormatListener(window.Handle); enabled = false; }
    }
    public void IgnoreOwnWrite() => detector.Ignore(PInvoke.GetClipboardSequenceNumber());
    public void BeginOwnWrites() { ownWrites++; IgnoreOwnWrite(); }
    public void EndOwnWrites() { IgnoreOwnWrite(); ownWrites--; }
    private void OnMessage(uint message, nuint wParam, nint lParam)
    {
        if (message != PInvoke.WM_CLIPBOARDUPDATE || !enabled) return;
        if (ownWrites > 0 || ClipboardAccess.IsOurProcessOwner) { IgnoreOwnWrite(); return; }
        if (detector.Observe(PInvoke.GetClipboardSequenceNumber(), clock.Elapsed)) DoubleCopied?.Invoke();
    }
    public void Dispose() { SetEnabled(false); window.Message -= OnMessage; }
}
