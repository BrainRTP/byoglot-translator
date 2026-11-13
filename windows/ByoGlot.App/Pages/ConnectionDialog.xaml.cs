using ByoGlot.App.Services;
using ByoGlot.Core;
using Microsoft.UI.Xaml.Controls;

namespace ByoGlot.App.Pages;

public sealed partial class ConnectionDialog : ContentDialog
{
    private readonly Connection? connection;
    private readonly ComboBox preset = new() { DisplayMemberPath = "Name", SelectedValuePath = "Id" };
    private readonly TextBox name = new();
    private readonly TextBox url = new();
    private readonly PasswordBox key = new();
    private readonly CheckBox consent = new();
    private readonly TextBlock error = new() { TextWrapping = Microsoft.UI.Xaml.TextWrapping.Wrap };
    public ConnectionDialog(Connection? connection)
    {
        this.connection = connection;
        InitializeComponent();
        Title = Strings.Get(connection is null ? "AddConnection" : "EditConnection");
        PrimaryButtonText = Strings.Get("Save"); CloseButtonText = Strings.Get("Cancel");
        preset.Header = Strings.Get("Preset"); name.Header = Strings.Get("Name"); url.Header = Strings.Get("BaseUrl"); key.Header = Strings.Get("ApiKey");
        preset.ItemsSource = Enum.GetValues<ProviderPreset>().Select(p => new PageSupport.Choice<ProviderPreset>(p, PageSupport.PresetName(p))).ToArray();
        preset.SelectedValue = connection?.Preset ?? ProviderPreset.Deepseek;
        name.Text = connection?.Name ?? "DeepSeek"; url.Text = connection?.BaseUrl ?? Contracts.Presets[ProviderPreset.Deepseek].BaseUrl;
        preset.SelectionChanged += (_, _) => { if (preset.SelectedValue is ProviderPreset p) { url.Text = Contracts.Presets[p].BaseUrl; name.Text = PageSupport.PresetName(p); } };
        url.TextChanged += (_, _) => { consent.IsChecked = false; UpdateConsent(); };
        UpdateConsent();
        foreach (var element in new Microsoft.UI.Xaml.UIElement[] { preset, name, url, key, consent, error }) Panel.Children.Add(element);
        PrimaryButtonClick += Save;
    }
    private void UpdateConsent()
    {
        var origin = Origins.OriginOf(url.Text);
        consent.Content = Strings.Format("Consent_Text", origin ?? "");
        consent.Visibility = origin is not null && !Origins.IsLocalHost(new Uri(origin).Host) ? Microsoft.UI.Xaml.Visibility.Visible : Microsoft.UI.Xaml.Visibility.Collapsed;
    }
    private async void Save(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        var deferral = args.GetDeferral();
        IsPrimaryButtonEnabled = false;
        try
        {
            var draft = new ConnectionDraft(connection?.Id, (ProviderPreset)preset.SelectedValue, name.Text, url.Text, key.Password);
            await AppServices.Current.Editor.SaveAsync(draft, consent.IsChecked == true, CancellationToken.None);
            key.Password = "";
        }
        catch (RunnerException e) { error.Text = ErrorText.Text(e.Error); args.Cancel = true; }
        catch (BackendException e) { error.Text = ErrorText.Text(new RunnerError.Backend(e)); args.Cancel = true; }
        catch (ArgumentException) { error.Text = Strings.Get("Err_InvalidConnection"); args.Cancel = true; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.Cryptography.CryptographicException) { error.Text = Strings.Get("Err_Storage"); args.Cancel = true; }
        finally { IsPrimaryButtonEnabled = true; deferral.Complete(); }
    }
}
