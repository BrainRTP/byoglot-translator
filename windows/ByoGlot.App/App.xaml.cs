using ByoGlot.App.Services;
using ByoGlot.App.Shell;
using ByoGlot.Core.Capture;
using Microsoft.UI.Xaml;
using Windows.ApplicationModel.DataTransfer;
using Windows.Win32;

namespace ByoGlot.App;

public partial class App : Application
{
    public MainWindow Main { get; private set; } = null!;
    public CaptureSettings CaptureSettings { get; } = new();
    public bool HotKeyRegistered { get; private set; }
    private MessageWindow messages = null!;
    private HotKeyService hotKey = null!;
    private ClipboardListener clipboard = null!;
    private QuickCoordinator quick = null!;
    private TrayIcon tray = null!;
    public App() => InitializeComponent();
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        Main = new MainWindow();
        messages = new MessageWindow();
        hotKey = new HotKeyService(messages);
        clipboard = new ClipboardListener(messages);
        quick = new QuickCoordinator(new SelectionReader(() => CaptureSettings.Fallback, clipboard));
        HotKeyRegistered = hotKey.Register(CaptureSettings.HotKey);
        clipboard.SetEnabled(CaptureSettings.DoubleCopy);
        clipboard.DoubleCopied += () => _ = CaptureAsync(false);
        messages.Message += (message, _, _) => { if (message == PInvoke.WM_HOTKEY) _ = CaptureAsync(true); };
        tray = new TrayIcon(messages, () => ShowMain(), () => new (string, Action)[]
        {
            (Strings.Get("TranslateSelection") + " (" + CaptureSettings.HotKey.Display + ")", () => _ = CaptureAsync(true)),
            (Strings.Get("TranslateClipboard"), () => _ = CaptureAsync(false)),
            (Strings.Get("Open"), () => ShowMain()),
            (Strings.Get("Settings"), () => ShowMain("Settings")),
            (Strings.Get("Quit"), Quit)
        });
        Main.AppWindow.Closing += (_, args) => { args.Cancel = true; Main.AppWindow.Hide(); };
        Main.Activate();
    }
    private async Task CaptureAsync(bool selection)
    {
        try { if (selection) await quick.SelectionAsync(); else await quick.ClipboardAsync(); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Runtime.InteropServices.COMException) { quick.Dismiss(); }
    }
    public bool SetHotKey(HotKey key)
    {
        if (!hotKey.Register(key)) return false;
        CaptureSettings.HotKey = key; HotKeyRegistered = true; return true;
    }
    public void SetDoubleCopy(bool enabled) { CaptureSettings.DoubleCopy = enabled; clipboard.SetEnabled(enabled); }
    public void ShowMain(string page = "Translate") { Main.Open(page); Main.Activate(); }
    public void Copy(string text)
    {
        clipboard.BeginOwnWrites();
        try { var data = new DataPackage(); data.SetText(text); Clipboard.SetContent(data); }
        finally { clipboard.EndOwnWrites(); }
    }
    private void Quit()
    {
        quick.Dismiss(); tray.Dispose(); clipboard.Dispose(); hotKey.Dispose(); messages.Dispose(); AppServices.Current.Transport.Dispose(); Exit();
    }
}
