using ByoGlot.App.Pages;
using ByoGlot.App.Services;
using ByoGlot.App.ViewModels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace ByoGlot.App;

public sealed partial class MainWindow : Window
{
    public MainViewModel Model { get; } = new();
    public MainWindow()
    {
        InitializeComponent();
        Title = "ByoGlot";
        SystemBackdrop = new MicaBackdrop();
        foreach (var key in new[] { "Translate", "Templates", "Connections" }) Navigation.MenuItems.Add(new NavigationViewItem { Content = Strings.Get(key), Tag = key });
        ((NavigationViewItem)Navigation.SettingsItem).Content = Strings.Get("Settings");
        Open("Translate");
    }
    public void Open(string page)
    {
        var item = page == "Settings" ? Navigation.SettingsItem : Navigation.MenuItems.OfType<NavigationViewItem>().FirstOrDefault(i => i.Tag as string == page) ?? Navigation.MenuItems[0];
        if (!ReferenceEquals(Navigation.SelectedItem, item)) Navigation.SelectedItem = item;
        else LoadPage(page);
    }
    private void LoadPage(string page) => ContentFrame.Content = page switch { "Connections" => new ConnectionsPage(), "Templates" => new TemplatesPage(), "Settings" => new SettingsPage(), _ => new TranslatePage(Model) };
    private void Navigate(NavigationView sender, NavigationViewSelectionChangedEventArgs args) => LoadPage(args.IsSettingsSelected ? "Settings" : (args.SelectedItemContainer?.Tag as string ?? "Translate"));
}
