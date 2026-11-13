using ByoGlot.App.Pages;
using ByoGlot.App.Services;
using ByoGlot.Core;
using ByoGlot.Core.Capture;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.Graphics;
using VirtualKey = Windows.System.VirtualKey;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Gdi;
using Windows.Win32.UI.HiDpi;
using Windows.Win32.UI.Input.KeyboardAndMouse;
using Windows.Win32.UI.WindowsAndMessaging;

namespace ByoGlot.App.Shell;

public sealed partial class QuickWindow : Window
{
    private readonly TextBlock source = new() { MaxLines = 2, TextWrapping = TextWrapping.Wrap, TextTrimming = TextTrimming.CharacterEllipsis };
    private readonly TextBlock result = new() { TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true };
    private readonly ProgressBar progress = new() { IsIndeterminate = true };
    private readonly ToggleSwitch pin = new();
    private readonly ComboBox templates = new() { DisplayMemberPath = "Name", SelectedValuePath = "Id" };
    private readonly DispatcherQueueTimer timer;
    private bool leftDown;
    private bool showing;
    private bool updating;
    private string original = "";
    private readonly HWND handle;
    public event Action? Dismissed;
    public event Action<string?>? TemplateChanged;
    public QuickWindow()
    {
        InitializeComponent(); Title = "ByoGlot";
        handle = new(WinRT.Interop.WindowNative.GetWindowHandle(this));
        var presenter = OverlappedPresenter.Create();
        presenter.IsAlwaysOnTop = true; presenter.IsMinimizable = false; presenter.IsMaximizable = false; presenter.IsResizable = true;
        AppWindow.SetPresenter(presenter);
        PInvoke.SetWindowLongPtr(handle, WINDOW_LONG_PTR_INDEX.GWL_EXSTYLE, PInvoke.GetWindowLongPtr(handle, WINDOW_LONG_PTR_INDEX.GWL_EXSTYLE) | (nint)(WINDOW_EX_STYLE.WS_EX_NOACTIVATE | WINDOW_EX_STYLE.WS_EX_TOOLWINDOW));
        pin.Header = Strings.Get("Pin"); templates.Header = Strings.Get("Template");
        templates.SelectionChanged += (_, _) => { if (!updating) TemplateChanged?.Invoke(templates.SelectedValue as string); };
        foreach (var element in new UIElement[] { source, progress, result, PageSupport.Button("Copy", () => ((App)Application.Current).Copy(result.Text)), templates, PageSupport.Button("OpenEditor", () => { ((App)Application.Current).Main.Model.Text = original; ((App)Application.Current).ShowMain(); }), pin }) Panel.Children.Add(element);
        AppWindow.Closing += (_, args) => { args.Cancel = true; Dismiss(); };
        timer = DispatcherQueue.CreateTimer(); timer.Interval = TimeSpan.FromMilliseconds(75);
        timer.Tick += (_, _) => CheckOutsideClick();
    }
    public async Task<string?> SetTemplatesAsync(string? selected)
    {
        var settings = await AppServices.Current.Settings.ReadAsync();
        updating = true;
        templates.ItemsSource = PageSupport.TemplateChoices(settings.Templates);
        templates.SelectedValue = settings.Templates.Any(t => t.Id == selected) ? selected : settings.Globals.DefaultTemplateId;
        updating = false;
        return templates.SelectedValue as string;
    }
    public void Render(QuickState state)
    {
        if (state is QuickState.Hidden) { AppWindow.Hide(); showing = false; timer.Stop(); original = ""; source.Text = ""; result.Text = ""; return; }
        original = state switch { QuickState.Translating t => t.Source, QuickState.Done d => d.Source, QuickState.Failed f => f.Source, _ => "" };
        source.Text = original;
        result.Text = state switch { QuickState.Message m => Strings.Get(m.ResourceKey), QuickState.Done d => d.Result.Text, QuickState.Failed f => ErrorText.Text(f.Error), _ => Strings.Get("Working") };
        progress.Visibility = state is QuickState.Translating ? Visibility.Visible : Visibility.Collapsed;
        if (showing) return;
        Place();
        leftDown = PInvoke.GetAsyncKeyState((int)VIRTUAL_KEY.VK_LBUTTON) < 0;
        showing = true;
        AppWindow.Show(activateWindow: false);
        timer.Start();
    }
    private unsafe void Place()
    {
        PInvoke.GetCursorPos(out var cursor);
        var monitor = PInvoke.MonitorFromPoint(cursor, MONITOR_FROM_FLAGS.MONITOR_DEFAULTTONEAREST);
        var info = new MONITORINFO { cbSize = (uint)sizeof(MONITORINFO) };
        if (!PInvoke.GetMonitorInfo(monitor, ref info)) return;
        PInvoke.GetDpiForMonitor(monitor, MONITOR_DPI_TYPE.MDT_EFFECTIVE_DPI, out var dpi, out _);
        var scale = (dpi == 0 ? 96 : dpi) / 96.0;
        var work = info.rcWork;
        var frame = PanelPlacement.Frame(cursor.X, cursor.Y, (int)(380 * scale), (int)(240 * scale), new(work.left, work.top, work.right - work.left, work.bottom - work.top));
        AppWindow.MoveAndResize(new RectInt32(frame.Left, frame.Top, frame.Width, frame.Height));
    }
    private void CheckOutsideClick()
    {
        var down = PInvoke.GetAsyncKeyState((int)VIRTUAL_KEY.VK_LBUTTON) < 0;
        if (down && !leftDown && !pin.IsOn)
        {
            PInvoke.GetCursorPos(out var point);
            var position = AppWindow.Position; var size = AppWindow.Size;
            if (point.X < position.X || point.Y < position.Y || point.X >= position.X + size.Width || point.Y >= position.Y + size.Height) Dismiss();
        }
        leftDown = down;
    }
    private void OnPointerPressed(object sender, PointerRoutedEventArgs args)
    {
        PInvoke.SetForegroundWindow(handle);
    }
    private void OnKeyDown(object sender, KeyRoutedEventArgs args) { if (args.Key == VirtualKey.Escape && !pin.IsOn) { Dismiss(); args.Handled = true; } }
    private void Dismiss() => Dismissed?.Invoke();
}
