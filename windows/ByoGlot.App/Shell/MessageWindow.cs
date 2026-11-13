using System.Runtime.InteropServices;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.WindowsAndMessaging;

namespace ByoGlot.App.Shell;

public sealed class MessageWindow : IDisposable
{
    private readonly WNDPROC procedure;
    internal HWND Handle { get; }
    internal HWND BroadcastHandle { get; }
    public const uint TrayMessage = 0x8001;
    public event Action<uint, nuint, nint>? Message;
    public unsafe MessageWindow()
    {
        procedure = WindowProcedure;
        var instance = PInvoke.GetModuleHandle((string?)null);
        fixed (char* name = "ByoGlot.MessageWindow")
        {
            var windowClass = new WNDCLASSEXW { cbSize = (uint)Marshal.SizeOf<WNDCLASSEXW>(), lpfnWndProc = procedure, hInstance = new HINSTANCE(instance.DangerousGetHandle()), lpszClassName = name };
            var atom = PInvoke.RegisterClassEx(in windowClass);
            if (atom == 0) throw new InvalidOperationException();
            Handle = PInvoke.CreateWindowEx(0, "ByoGlot.MessageWindow", "", 0, 0, 0, 0, 0, HWND.HWND_MESSAGE, null, instance, null);
            if (Handle.IsNull) throw new InvalidOperationException();
            // Message-only windows do not receive Explorer's TaskbarCreated broadcast.
            BroadcastHandle = PInvoke.CreateWindowEx(WINDOW_EX_STYLE.WS_EX_TOOLWINDOW, "ByoGlot.MessageWindow", "", WINDOW_STYLE.WS_POPUP, 0, 0, 0, 0, default, null, instance, null);
            if (BroadcastHandle.IsNull) throw new InvalidOperationException();
        }
    }
    private LRESULT WindowProcedure(HWND handle, uint message, WPARAM wParam, LPARAM lParam)
    {
        Message?.Invoke(message, wParam.Value, lParam.Value);
        return PInvoke.DefWindowProc(handle, message, wParam, lParam);
    }
    public void Dispose() { PInvoke.DestroyWindow(BroadcastHandle); PInvoke.DestroyWindow(Handle); }
}
