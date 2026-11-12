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
        var profile = new ComboBox { Header = Strings.Get("Profile"), ItemsSource = new[] { "auto" }.Concat(Contracts.BuiltinProfiles.Keys), SelectedItem = settings.Globals.LanguageProfile };
        profile.SelectionChanged += (_, _) => _ = PageSupport.Guard(this, async () => { if (profile.SelectedItem is string id) await AppServices.Current.Settings.UpdateAsync(s => s with { Globals = s.Globals with { LanguageProfile = id } }); });
        Panel.Children.Add(profile);
        Panel.Children.Add(PageSupport.Button("Export", () => _ = PageSupport.Guard(this, Export)));
        Panel.Children.Add(PageSupport.Button("Import", () => _ = PageSupport.Guard(this, Import)));
        Panel.Children.Add(PageSupport.Button("Project", () => _ = Launcher.LaunchUriAsync(new Uri("https://github.com/BrainRTP/byoglot-translator"))));
        Panel.Children.Add(PageSupport.Button("Privacy", () => _ = Launcher.LaunchUriAsync(new Uri("https://github.com/BrainRTP/byoglot-translator/blob/main/PRIVACY.md"))));
        var v = Package.Current.Id.Version;
        Panel.Children.Add(new TextBlock { Text = Strings.Get("Version") + $" {v.Major}.{v.Minor}.{v.Build}" });
    }
    private void AddCaptureSettings() { }
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
