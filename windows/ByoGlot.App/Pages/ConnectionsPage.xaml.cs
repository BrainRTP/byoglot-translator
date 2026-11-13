using ByoGlot.App.Services;
using ByoGlot.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace ByoGlot.App.Pages;

public sealed partial class ConnectionsPage : Page
{
    public ConnectionsPage() { InitializeComponent(); Loaded += (_, _) => _ = PageSupport.Guard(this, Refresh); }
    private async Task Refresh()
    {
        Panel.Children.Clear();
        Panel.Children.Add(PageSupport.Button("AddConnection", () => _ = Edit(null)));
        var settings = await AppServices.Current.Settings.ReadAsync();
        foreach (var connection in settings.Connections)
        {
            var missing = ProviderEffort.NeedsKey(connection.Preset, connection.BaseUrl) && !await AppServices.Current.Editor.KeyStateAsync(connection.Id);
            Panel.Children.Add(new TextBlock { Text = connection.Name + (settings.ActiveConnectionId == connection.Id ? " (" + Strings.Get("Active") + ")" : "") + (missing ? " (" + Strings.Get("KeyMissing") + ")" : ""), FontSize = 20 });
            Panel.Children.Add(new TextBlock { Text = connection.BaseUrl });
            Panel.Children.Add(PageSupport.Button("Edit", () => _ = Edit(connection)));
            Panel.Children.Add(PageSupport.Button("Activate", () => _ = PageSupport.Guard(this, async () => { await AppServices.Current.Settings.UpdateAsync(s => s with { ActiveConnectionId = connection.Id }); await Refresh(); })));
            Panel.Children.Add(PageSupport.Button("ChooseModels", () => _ = PageSupport.Guard(this, () => Models(connection))));
            Panel.Children.Add(PageSupport.Button("Delete", () => _ = PageSupport.Guard(this, async () =>
            {
                var confirm = new ContentDialog { XamlRoot = XamlRoot, Title = Strings.Get("DeleteConnection"), PrimaryButtonText = Strings.Get("Delete"), CloseButtonText = Strings.Get("Cancel") };
                if (await confirm.ShowAsync() == ContentDialogResult.Primary) { await AppServices.Current.Editor.RemoveAsync(connection.Id); await Refresh(); }
            })));
        }
    }
    private Task Edit(Connection? connection) => PageSupport.Guard(this, async () =>
    {
        var dialog = new ConnectionDialog(connection) { XamlRoot = XamlRoot };
        if (await dialog.ShowAsync() == ContentDialogResult.Primary) await Refresh();
    });
    private async Task Models(Connection connection)
    {
        var models = await AppServices.Current.Editor.ModelsAsync(connection.Id, CancellationToken.None);
        var page = new ComboBox { Header = Strings.Get("PageModel"), ItemsSource = models, DisplayMemberPath = "Name", SelectedItem = models.FirstOrDefault(m => m.Id == connection.PageModel?.Id) };
        var selection = new ComboBox { Header = Strings.Get("SelectionModel"), ItemsSource = models, DisplayMemberPath = "Name", SelectedItem = models.FirstOrDefault(m => m.Id == connection.SelectionModel?.Id) };
        var effort = new ComboBox { Header = Strings.Get("Effort"), ItemsSource = PageSupport.EffortChoices((selection.SelectedItem as ModelInfo)?.Variants ?? []), DisplayMemberPath = "Name", SelectedValuePath = "Id", SelectedValue = connection.SelectionModel?.Variant };
        selection.SelectionChanged += (_, _) => { effort.ItemsSource = PageSupport.EffortChoices((selection.SelectedItem as ModelInfo)?.Variants ?? []); effort.SelectedIndex = 0; };
        var content = new StackPanel { Spacing = 12 }; content.Children.Add(page); content.Children.Add(selection); content.Children.Add(effort);
        var dialog = new ContentDialog { XamlRoot = XamlRoot, Title = Strings.Get("ChooseModels"), Content = content, PrimaryButtonText = Strings.Get("Save"), CloseButtonText = Strings.Get("Cancel") };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        ModelRef? Reference(ComboBox picker, string? variant) => picker.SelectedItem is ModelInfo m ? new(m.ProviderID, m.Id, variant, connection.Id) : null;
        await AppServices.Current.Settings.UpdateAsync(s => s with { Connections = s.Connections.Select(c => c.Id == connection.Id ? c with { PageModel = Reference(page, null), SelectionModel = Reference(selection, effort.SelectedValue as string) } : c).ToArray() });
    }
}
