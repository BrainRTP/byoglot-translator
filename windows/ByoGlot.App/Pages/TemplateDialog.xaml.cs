using ByoGlot.App.Services;
using ByoGlot.Core;
using Microsoft.UI.Xaml.Controls;

namespace ByoGlot.App.Pages;

public sealed partial class TemplateDialog : ContentDialog
{
    private readonly TextBox name = new();
    private readonly TextBox instructions = new() { AcceptsReturn = true, TextWrapping = Microsoft.UI.Xaml.TextWrapping.Wrap, MinHeight = 150 };
    private readonly ComboBox target = PageSupport.Languages();
    private readonly Template? original;
    public Template Value => new(original?.Id ?? Guid.NewGuid().ToString(), name.Text.Trim(), false, (original?.Settings ?? new()) with { PrePrompt = instructions.Text, TargetLang = target.SelectedValue as string });
    public TemplateDialog(Template? original, bool duplicate = false)
    {
        this.original = duplicate ? null : original;
        InitializeComponent();
        Title = Strings.Get("Template"); PrimaryButtonText = Strings.Get("Save"); CloseButtonText = Strings.Get("Cancel");
        name.Header = Strings.Get("Name"); instructions.Header = Strings.Get("Instructions"); target.Header = Strings.Get("OptionalTarget");
        name.Text = original?.Name ?? ""; instructions.Text = original?.Settings.PrePrompt ?? ""; target.SelectedValue = original?.Settings.TargetLang;
        Panel.Children.Add(name); Panel.Children.Add(instructions); Panel.Children.Add(target);
        Panel.Children.Add(PageSupport.Button("ClearTarget", () => target.SelectedIndex = -1));
        PrimaryButtonClick += (_, args) => args.Cancel = name.Text.Trim().Length == 0;
    }
}
