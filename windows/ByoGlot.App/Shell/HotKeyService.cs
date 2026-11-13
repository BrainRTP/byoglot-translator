using ByoGlot.Core.Capture;
using Windows.Win32;
using Windows.Win32.UI.Input.KeyboardAndMouse;

namespace ByoGlot.App.Shell;

public sealed class HotKeyService(MessageWindow window) : IDisposable
{
    private HotKey? registered;
    public bool Register(HotKey key)
    {
        if (!key.IsValid) return false;
        PInvoke.UnregisterHotKey(window.Handle, 1);
        if (PInvoke.RegisterHotKey(window.Handle, 1, (HOT_KEY_MODIFIERS)(key.Modifiers | 0x4000), key.VirtualKey)) { registered = key; return true; }
        if (registered is { } old) PInvoke.RegisterHotKey(window.Handle, 1, (HOT_KEY_MODIFIERS)(old.Modifiers | 0x4000), old.VirtualKey);
        return false;
    }
    public void Dispose() => PInvoke.UnregisterHotKey(window.Handle, 1);
}
