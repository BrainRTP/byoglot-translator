using ByoGlot.Core.Capture;
using Windows.Storage;

namespace ByoGlot.App.Shell;

public sealed class CaptureSettings
{
    private readonly ApplicationDataContainer settings = ApplicationData.Current.LocalSettings;
    public HotKey HotKey
    {
        get => settings.Values["HotKeyModifiers"] is uint modifiers && settings.Values["HotKeyVirtualKey"] is uint key && new HotKey(modifiers, key).IsValid ? new(modifiers, key) : HotKey.Default;
        set { settings.Values["HotKeyModifiers"] = value.Modifiers; settings.Values["HotKeyVirtualKey"] = value.VirtualKey; }
    }
    public bool Fallback { get => settings.Values["CopyFallback"] is not false; set => settings.Values["CopyFallback"] = value; }
    public bool DoubleCopy { get => settings.Values["DoubleCopy"] is true; set => settings.Values["DoubleCopy"] = value; }
}
