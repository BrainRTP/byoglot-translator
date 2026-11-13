using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using ByoGlot.Core;
using ByoGlot.Core.Capture;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Security;
using Windows.Win32.System.Com;
using Windows.Win32.System.Threading;
using Windows.Win32.UI.Accessibility;
using Windows.Win32.UI.Input.KeyboardAndMouse;

namespace ByoGlot.App.Shell;

public sealed class SelectionReader(Func<bool> fallbackAllowed, ClipboardListener clipboard)
{
    private static readonly SemaphoreSlim AutomationGate = new(1, 1);
    private readonly SemaphoreSlim copyGate = new(1, 1);
    public string AppName { get; private set; } = "";

    public async Task<CaptureResult> ReadAsync()
    {
        var foreground = PInvoke.GetForegroundWindow();
        AppName = ForegroundName(foreground);
        if (IsElevated(foreground)) return new CaptureResult.Elevated();
        var automation = await AutomationAsync();
        if (PInvoke.GetForegroundWindow() != foreground) return new CaptureResult.Nothing();
        if (automation.Private) return new CaptureResult.Clipboard(new ClipboardRead.Concealed());
        if (automation.Text?.Length > InputLimits.Quick) return new CaptureResult.Clipboard(new ClipboardRead.TooLong(InputLimits.Quick));
        return await CapturePlan.RunAsync(new(false, automation.Text, fallbackAllowed(), () => CopyAndRead(foreground), automation.Available));
    }

    private static async Task<(string? Text, bool Private, bool Available)> AutomationAsync()
    {
        if (!AutomationGate.Wait(0)) return (null, false, false);
        var completion = new TaskCompletionSource<(string?, bool, bool)>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            IUIAutomation? automation = null; IUIAutomationElement? element = null; IUIAutomationTextPattern? pattern = null; IUIAutomationTextRangeArray? ranges = null;
            bool initialized;
            unsafe { initialized = PInvoke.CoInitializeEx(null, COINIT.COINIT_APARTMENTTHREADED).Succeeded; }
            try
            {
                automation = (IUIAutomation)new CUIAutomation();
                element = automation.GetFocusedElement();
                if (element.CurrentIsPassword) { completion.TrySetResult((null, true, true)); return; }
                pattern = element.GetCurrentPattern(UIA_PATTERN_ID.UIA_TextPatternId) as IUIAutomationTextPattern;
                if (pattern is null) { completion.TrySetResult((null, false, true)); return; }
                ranges = pattern.GetSelection();
                var text = new StringBuilder();
                for (var i = 0; i < ranges.Length && text.Length <= InputLimits.Quick; i++)
                {
                    var range = ranges.GetElement(i);
                    try
                    {
                        unsafe
                        {
                            var value = range.GetText(InputLimits.Quick + 1 - text.Length);
                            try { text.Append(value.ToString()); }
                            finally { if (value.Value is not null) Marshal.FreeBSTR((nint)value.Value); }
                        }
                    }
                    finally { Marshal.ReleaseComObject(range); }
                }
                completion.TrySetResult((text.ToString(), false, true));
            }
            catch (COMException) { completion.TrySetResult((null, false, false)); }
            finally
            {
                foreach (var value in new object?[] { ranges, pattern, element, automation }) if (value is not null) Marshal.ReleaseComObject(value);
                if (initialized) PInvoke.CoUninitialize();
                AutomationGate.Release();
            }
        }) { IsBackground = true, Name = "ByoGlot selection" };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return await Task.WhenAny(completion.Task, Task.Delay(500)) == completion.Task ? await completion.Task : (null, false, false);
    }

    private async Task<ClipboardRead> CopyAndRead(HWND foreground)
    {
        await copyGate.WaitAsync();
        try
        {
            for (var i = 0; i < 30 && ModifiersDown(); i++) await Task.Delay(10);
            if (ModifiersDown() || PInvoke.GetForegroundWindow() != foreground || IsElevated(foreground)) return new ClipboardRead.Empty();
            clipboard.BeginOwnWrites();
            try { return await ClipboardCopy.RunAsync(new CopyBackend(foreground)); }
            finally { clipboard.EndOwnWrites(); }
        }
        finally { copyGate.Release(); }
    }

    private sealed class CopyBackend(HWND foreground) : IClipboardCopyBackend
    {
        public uint Sequence => PInvoke.GetClipboardSequenceNumber();
        public bool IsExcluded => ClipboardAccess.IsExcluded;
        public IClipboardSnapshot? Snapshot()
        {
            var sequence = Sequence;
            if (IsExcluded || PInvoke.OleGetClipboard(out var source).Failed) return null;
            try
            {
                return source is null ? null : ClipboardSnapshot.Capture(source, () => Sequence == sequence && !IsExcluded);
            }
            finally { if (source is not null) Marshal.ReleaseComObject(source); }
        }
        public unsafe bool TryCopy()
        {
            if (ModifiersDown() || PInvoke.GetForegroundWindow() != foreground || IsElevated(foreground)) return false;
            INPUT Key(VIRTUAL_KEY key, bool up = false) => new() { type = INPUT_TYPE.INPUT_KEYBOARD, Anonymous = new INPUT._Anonymous_e__Union { ki = new KEYBDINPUT { wVk = key, dwFlags = up ? KEYBD_EVENT_FLAGS.KEYEVENTF_KEYUP : 0 } } };
            ReadOnlySpan<INPUT> input = [Key(VIRTUAL_KEY.VK_CONTROL), Key(VIRTUAL_KEY.VK_C), Key(VIRTUAL_KEY.VK_C, true), Key(VIRTUAL_KEY.VK_CONTROL, true)];
            return PInvoke.SendInput(input, sizeof(INPUT)) == input.Length;
        }
        public async Task WaitForChangeAsync(uint previous)
        {
            for (var i = 0; i < 40 && previous == Sequence; i++) await Task.Delay(10);
        }
        public ClipboardRead ReadChanged(uint previous, uint current) => ClipboardAccess.ReadChanged(previous, current, InputLimits.Quick);
        public async Task RestoreAsync(IClipboardSnapshot snapshot, uint expectedSequence)
        {
            for (var i = 0; i < 40; i++)
            {
                if (Sequence != expectedSequence) return;
                if (((ClipboardSnapshot)snapshot).Publish()) return;
                await Task.Delay(10);
            }
            throw new COMException("Clipboard restoration failed.");
        }
    }

    private static bool ModifiersDown() => new[] { VIRTUAL_KEY.VK_CONTROL, VIRTUAL_KEY.VK_MENU, VIRTUAL_KEY.VK_SHIFT, VIRTUAL_KEY.VK_LWIN, VIRTUAL_KEY.VK_RWIN }.Any(key => PInvoke.GetAsyncKeyState((int)key) < 0);
    private static unsafe bool IsElevated(HWND foreground)
    {
        uint id;
        PInvoke.GetWindowThreadProcessId(foreground, &id);
        using var process = PInvoke.OpenProcess_SafeHandle(PROCESS_ACCESS_RIGHTS.PROCESS_QUERY_LIMITED_INFORMATION, false, id);
        if (process.IsInvalid || !PInvoke.OpenProcessToken(process, TOKEN_ACCESS_MASK.TOKEN_QUERY, out var token)) return true;
        using (token)
        {
            TOKEN_ELEVATION elevation;
            return !PInvoke.GetTokenInformation(token, TOKEN_INFORMATION_CLASS.TokenElevation, &elevation, (uint)sizeof(TOKEN_ELEVATION), out _) || elevation.TokenIsElevated != 0;
        }
    }
    private static unsafe string ForegroundName(HWND foreground)
    {
        uint id; PInvoke.GetWindowThreadProcessId(foreground, &id);
        try { using var process = Process.GetProcessById((int)id); return process.MainModule?.FileVersionInfo.FileDescription ?? process.ProcessName; }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { return ""; }
    }
}
