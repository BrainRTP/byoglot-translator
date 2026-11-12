using ByoGlot.App.Services;
using ByoGlot.App.ViewModels;
using ByoGlot.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.ApplicationModel.DataTransfer;

namespace ByoGlot.App.Pages;

public sealed partial class TranslatePage : Page
{
    private readonly MainViewModel model;
    private readonly TextBox input = new() { AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 180, MaxLength = InputLimits.Editor + 1 };
    private readonly TextBlock output = new() { IsTextSelectionEnabled = true, TextWrapping = TextWrapping.Wrap };
    private readonly TextBlock error = new() { TextWrapping = TextWrapping.Wrap };
    private readonly Button translate;
    private readonly Button fix;
    private readonly ProgressBar progress = new() { IsIndeterminate = true };
    public TranslatePage(MainViewModel model)
    {
        this.model = model;
        InitializeComponent();
        input.Header = Strings.Get("Input");
        input.Text = model.Text;
        input.TextChanged += (_, _) => model.Text = input.Text;
        Panel.Children.Add(input);
        Panel.Children.Add(PageSupport.Button("Paste", () => _ = PageSupport.Guard(this, async () =>
        {
            var value = Clipboard.GetContent();
            if (value.Contains(StandardDataFormats.Text)) input.Text = await value.GetTextAsync();
        })));
        Loaded += (_, _) => _ = PageSupport.Guard(this, LoadSettings);
        translate = PageSupport.Button("Translate", () => _ = PageSupport.Guard(this, async () => { if (model.State.Phase is TranslatePhase.Working) model.State.Cancel(); else await model.State.TranslateAsync(input.Text, model.TemplateId); }));
        fix = PageSupport.Button("FixConnection", () => ((App)Application.Current).ShowMain("Connections"));
        Panel.Children.Add(translate);
        Panel.Children.Add(progress);
        Panel.Children.Add(error);
        Panel.Children.Add(fix);
        Panel.Children.Add(output);
        Panel.Children.Add(PageSupport.Button("Copy", () => ((App)Application.Current).Copy(output.Text)));
        model.State.Changed += Refresh;
        Unloaded += (_, _) => model.State.Changed -= Refresh;
        Refresh();
    }
    private async Task LoadSettings()
    {
        var settings = await AppServices.Current.Settings.ReadAsync();
        var source = PageSupport.Languages(true);
        var target = PageSupport.Languages();
        source.Header = Strings.Get("Source"); target.Header = Strings.Get("Target");
        source.SelectedValue = settings.Globals.SourceLang; target.SelectedValue = settings.Globals.TargetLang;
        source.SelectionChanged += (_, _) => _ = PageSupport.Guard(this, async () => { if (source.SelectedValue is string code) await AppServices.Current.Settings.UpdateAsync(s => s with { Globals = s.Globals with { SourceLang = code } }); });
        target.SelectionChanged += (_, _) => _ = PageSupport.Guard(this, async () => { if (target.SelectedValue is string code) await AppServices.Current.Settings.UpdateAsync(s => s with { Globals = s.Globals with { TargetLang = code } }); });
        var templates = new ComboBox { Header = Strings.Get("Template"), ItemsSource = settings.Templates, DisplayMemberPath = "Name", SelectedValuePath = "Id", SelectedValue = model.TemplateId ?? settings.Globals.DefaultTemplateId };
        templates.SelectionChanged += (_, _) => model.TemplateId = templates.SelectedValue as string;
        Panel.Children.Insert(2, source); Panel.Children.Insert(3, target); Panel.Children.Insert(4, templates);
    }
    private void Refresh()
    {
        translate.Content = Strings.Get(model.State.Phase is TranslatePhase.Working ? "Cancel" : "Translate");
        progress.Visibility = model.State.Phase is TranslatePhase.Working ? Visibility.Visible : Visibility.Collapsed;
        output.Text = model.State.Phase is TranslatePhase.Done done ? done.Output.Text : "";
        error.Text = model.State.Phase is TranslatePhase.Failed failed ? ErrorText.Text(failed.Error) : "";
        fix.Visibility = model.State.Phase is TranslatePhase.Failed { Error: RunnerError.NoConnection or RunnerError.NoModel or RunnerError.KeyMissing or RunnerError.ConsentNeeded } ? Visibility.Visible : Visibility.Collapsed;
    }
}
