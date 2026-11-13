using ByoGlot.App.Services;
using ByoGlot.Core.Capture;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.Win32;
using Windows.Win32.UI.Input.KeyboardAndMouse;

namespace ByoGlot.App.Shell;

public sealed partial class HotKeyRecorder : UserControl
{
    public HotKeyRecorder()
    {
        InitializeComponent();
        Input.Header = Strings.Get("HotKey"); Input.PlaceholderText = Strings.Get("HotKeyHint");
        var app = (App)Microsoft.UI.Xaml.Application.Current;
        Input.Text = app.CaptureSettings.HotKey.Display;
        Error.Text = app.HotKeyRegistered ? "" : Strings.Get("HotKeyTaken");
    }
    private void Record(object sender, KeyRoutedEventArgs args)
    {
        uint modifiers = 0;
        if (PInvoke.GetKeyState((int)VIRTUAL_KEY.VK_CONTROL) < 0) modifiers |= 2;
        if (PInvoke.GetKeyState((int)VIRTUAL_KEY.VK_MENU) < 0) modifiers |= 1;
        if (PInvoke.GetKeyState((int)VIRTUAL_KEY.VK_SHIFT) < 0) modifiers |= 4;
        if (PInvoke.GetKeyState((int)VIRTUAL_KEY.VK_LWIN) < 0 || PInvoke.GetKeyState((int)VIRTUAL_KEY.VK_RWIN) < 0) modifiers |= 8;
        var key = new HotKey(modifiers, (uint)args.Key);
        args.Handled = true;
        if (!key.IsValid) { Error.Text = Strings.Get("HotKeyInvalid"); return; }
        var app = (App)Microsoft.UI.Xaml.Application.Current;
        if (!app.SetHotKey(key)) { Error.Text = Strings.Get("HotKeyTaken"); return; }
        Error.Text = ""; Input.Text = key.Display;
    }
}
