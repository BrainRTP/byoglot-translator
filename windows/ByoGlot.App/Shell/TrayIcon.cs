using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.Shell;
using Windows.Win32.UI.WindowsAndMessaging;

namespace ByoGlot.App.Shell;

public sealed class TrayIcon : IDisposable
{
    private readonly MessageWindow window;
    private NOTIFYICONDATAW data;
    private readonly Func<IReadOnlyList<(string Label, Action Action)>> menu;
    private readonly Action open;
    private readonly uint taskbarCreated = PInvoke.RegisterWindowMessage("TaskbarCreated");
    public unsafe TrayIcon(MessageWindow window, Action open, Func<IReadOnlyList<(string Label, Action Action)>> menu)
    {
        this.window = window; this.open = open; this.menu = menu;
        HICON icon;
        fixed (char* path = Path.Combine(AppContext.BaseDirectory, "Assets", "ByoGlot.ico"))
            icon = new(PInvoke.LoadImage(default(HINSTANCE), path, GDI_IMAGE_TYPE.IMAGE_ICON, 32, 32, IMAGE_FLAGS.LR_LOADFROMFILE).Value);
        if (icon.IsNull) throw new InvalidOperationException("Tray icon could not be loaded.");
        data = new() { cbSize = (uint)sizeof(NOTIFYICONDATAW), hWnd = window.Handle, uID = 1, uFlags = NOTIFY_ICON_DATA_FLAGS.NIF_MESSAGE | NOTIFY_ICON_DATA_FLAGS.NIF_ICON | NOTIFY_ICON_DATA_FLAGS.NIF_TIP, uCallbackMessage = MessageWindow.TrayMessage, hIcon = icon };
        data.szTip = "ByoGlot";
        PInvoke.Shell_NotifyIcon(NOTIFY_ICON_MESSAGE.NIM_ADD, in data);
        window.Message += OnMessage;
    }
    private void OnMessage(uint message, nuint wParam, nint lParam)
    {
        if (taskbarCreated != 0 && message == taskbarCreated) { PInvoke.Shell_NotifyIcon(NOTIFY_ICON_MESSAGE.NIM_ADD, in data); return; }
        if (message != MessageWindow.TrayMessage) return;
        if ((uint)lParam == PInvoke.WM_LBUTTONUP) open();
        if ((uint)lParam is PInvoke.WM_RBUTTONUP or PInvoke.WM_CONTEXTMENU) ShowMenu();
    }
    private void ShowMenu()
    {
        var items = menu();
        using var popup = PInvoke.CreatePopupMenu_SafeHandle();
        for (var i = 0; i < items.Count; i++) PInvoke.AppendMenu(popup, MENU_ITEM_FLAGS.MF_STRING, (nuint)(i + 1), items[i].Label);
        PInvoke.GetCursorPos(out var point);
        PInvoke.SetForegroundWindow(window.Handle);
        var selected = (int)PInvoke.TrackPopupMenu(popup, TRACK_POPUP_MENU_FLAGS.TPM_RETURNCMD | TRACK_POPUP_MENU_FLAGS.TPM_RIGHTBUTTON, point.X, point.Y, window.Handle, null);
        PInvoke.PostMessage(window.Handle, PInvoke.WM_NULL, default, default);
        if (selected > 0 && selected <= items.Count) items[selected - 1].Action();
    }
    public void Dispose() { window.Message -= OnMessage; PInvoke.Shell_NotifyIcon(NOTIFY_ICON_MESSAGE.NIM_DELETE, in data); PInvoke.DestroyIcon(data.hIcon); }
}
