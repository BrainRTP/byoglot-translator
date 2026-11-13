using ByoGlot.App.Services;
using ByoGlot.Core;
using Microsoft.UI.Xaml.Controls;
using Windows.ApplicationModel;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.System;

namespace ByoGlot.App.Pages;

public sealed partial class SettingsPage : Page
{
    public SettingsPage() { InitializeComponent(); Loaded += (_, _) => _ = PageSupport.Guard(this, LoadSettings); }
    private async Task LoadSettings()
    {
        Panel.Children.Clear();
        var startup = await StartupTask.GetAsync("ByoGlotStartup");
        var toggle = new ToggleSwitch { Header = Strings.Get("Startup"), IsOn = startup.State is StartupTaskState.Enabled or StartupTaskState.EnabledByPolicy, IsEnabled = startup.State is not (StartupTaskState.DisabledByUser or StartupTaskState.DisabledByPolicy or StartupTaskState.EnabledByPolicy) };
        var startupState = new TextBlock { Text = Strings.Get("Startup_" + startup.State) };
        toggle.Toggled += (_, _) => _ = PageSupport.Guard(this, async () =>
        {
            if (toggle.IsOn) await startup.RequestEnableAsync(); else startup.Disable();
            startupState.Text = Strings.Get("Startup_" + startup.State);
        });
        Panel.Children.Add(toggle); Panel.Children.Add(startupState);
        AddCaptureSettings();
        var settings = await AppServices.Current.Settings.ReadAsync();
        var language = new ToggleSwitch { Header = Strings.Get("LanguageStyle"), IsOn = settings.Globals.LanguagePromptEnabled };
        language.Toggled += (_, _) => _ = PageSupport.Guard(this, async () => { await AppServices.Current.Settings.UpdateAsync(s => s with { Globals = s.Globals with { LanguagePromptEnabled = language.IsOn } }); });
        Panel.Children.Add(language);
        var profiles = new[] { "auto" }.Concat(Contracts.BuiltinProfiles.Keys).Select(id => new PageSupport.Choice<string>(id, id is "auto" or "generic" or "ru" ? Strings.Get("Profile_" + id) : id)).ToArray();
        var profile = new ComboBox { Header = Strings.Get("Profile"), ItemsSource = profiles, DisplayMemberPath = "Name", SelectedValuePath = "Id", SelectedValue = settings.Globals.LanguageProfile };
        profile.SelectionChanged += (_, _) => _ = PageSupport.Guard(this, async () => { if (profile.SelectedValue is string id) await AppServices.Current.Settings.UpdateAsync(s => s with { Globals = s.Globals with { LanguageProfile = id } }); });
        Panel.Children.Add(profile);
        Panel.Children.Add(PageSupport.Button("Export", () => _ = PageSupport.Guard(this, Export)));
        Panel.Children.Add(PageSupport.Button("Import", () => _ = PageSupport.Guard(this, Import)));
        Panel.Children.Add(PageSupport.Button("Project", () => _ = Launcher.LaunchUriAsync(new Uri("https://github.com/BrainRTP/byoglot-translator"))));
        Panel.Children.Add(PageSupport.Button("Privacy", () => _ = Launcher.LaunchUriAsync(new Uri("https://github.com/BrainRTP/byoglot-translator/blob/main/PRIVACY.md"))));
        var v = Package.Current.Id.Version;
        Panel.Children.Add(new TextBlock { Text = Strings.Get("Version") + $" {v.Major}.{v.Minor}.{v.Build}" });
    }
    private void AddCaptureSettings()
    {
        var app = (App)Microsoft.UI.Xaml.Application.Current;
        Panel.Children.Add(new ByoGlot.App.Shell.HotKeyRecorder());
        var fallback = new ToggleSwitch { Header = Strings.Get("Fallback"), IsOn = app.CaptureSettings.Fallback };
        fallback.Toggled += (_, _) => app.CaptureSettings.Fallback = fallback.IsOn;
        var doubleCopy = new ToggleSwitch { Header = Strings.Get("DoubleCopy"), IsOn = app.CaptureSettings.DoubleCopy };
        doubleCopy.Toggled += (_, _) => app.SetDoubleCopy(doubleCopy.IsOn);
        Panel.Children.Add(fallback); Panel.Children.Add(doubleCopy);
    }
    private async Task Export()
    {
        var picker = new FileSavePicker { SuggestedFileName = "byoglot-settings" };
        picker.FileTypeChoices.Add(Strings.Get("SettingsFile"), new[] { ".json" });
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(((App)Microsoft.UI.Xaml.Application.Current).Main));
        if (await picker.PickSaveFileAsync() is { } file)
            await FileIO.WriteTextAsync(file, await ((App)Microsoft.UI.Xaml.Application.Current).Main.Model.State.ExportAsync(DateTimeOffset.UtcNow));
    }
    private async Task Import()
    {
        var picker = new FileOpenPicker(); picker.FileTypeFilter.Add(".json");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(((App)Microsoft.UI.Xaml.Application.Current).Main));
        if (await picker.PickSingleFileAsync() is { } file)
            await ((App)Microsoft.UI.Xaml.Application.Current).Main.Model.State.ImportAsync(await FileIO.ReadTextAsync(file));
    }
}
