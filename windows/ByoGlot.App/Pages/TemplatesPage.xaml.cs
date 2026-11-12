using ByoGlot.App.Services;
using ByoGlot.Core;
using Microsoft.UI.Xaml.Controls;

namespace ByoGlot.App.Pages;

public sealed partial class TemplatesPage : Page
{
    private readonly MainState state = new(AppServices.Current.Runner, AppServices.Current.Settings);
    public TemplatesPage() { InitializeComponent(); Loaded += (_, _) => _ = PageSupport.Guard(this, Refresh); }
    private async Task Refresh()
    {
        Panel.Children.Clear();
        Panel.Children.Add(PageSupport.Button("AddTemplate", () => _ = Edit(null, false)));
        var settings = await AppServices.Current.Settings.ReadAsync();
        foreach (var template in settings.Templates)
        {
            Panel.Children.Add(new TextBlock { Text = template.Builtin ? Strings.Get("BuiltinTemplate") : template.Name, FontSize = 20 });
            Panel.Children.Add(new TextBlock { Text = template.Settings.PrePrompt ?? "", TextWrapping = Microsoft.UI.Xaml.TextWrapping.Wrap });
            Panel.Children.Add(PageSupport.Button("Duplicate", () => _ = Edit(template, true)));
            Panel.Children.Add(PageSupport.Button("UseDefault", () => _ = PageSupport.Guard(this, async () => { await AppServices.Current.Settings.UpdateAsync(s => s with { Globals = s.Globals with { DefaultTemplateId = template.Id } }); })));
            if (template.Builtin) continue;
            Panel.Children.Add(PageSupport.Button("Edit", () => _ = Edit(template, false)));
            Panel.Children.Add(PageSupport.Button("Delete", () => _ = PageSupport.Guard(this, async () =>
            {
                var confirm = new ContentDialog { XamlRoot = XamlRoot, Title = Strings.Get("DeleteTemplate"), PrimaryButtonText = Strings.Get("Delete"), CloseButtonText = Strings.Get("Cancel") };
                if (await confirm.ShowAsync() == ContentDialogResult.Primary) { await state.DeleteTemplateAsync(template.Id); await Refresh(); }
            })));
        }
    }
    private Task Edit(Template? template, bool duplicate) => PageSupport.Guard(this, async () =>
    {
        var dialog = new TemplateDialog(template, duplicate) { XamlRoot = XamlRoot };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        var value = dialog.Value;
        await AppServices.Current.Settings.UpdateAsync(s => s with { Templates = s.Templates.Any(t => t.Id == value.Id) ? s.Templates.Select(t => t.Id == value.Id ? value : t).ToArray() : [.. s.Templates, value] });
        await Refresh();
    });
}
