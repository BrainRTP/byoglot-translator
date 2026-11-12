using System.Globalization;
using ByoGlot.App.Services;
using ByoGlot.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace ByoGlot.App.Pages;

internal static class PageSupport
{
    public static Button Button(string key, Action action)
    {
        var button = new Button { Content = Strings.Get(key) };
        button.Click += (_, _) => action();
        return button;
    }
    public static ComboBox Languages(bool auto = false) => new()
    {
        ItemsSource = (auto ? new[] { "auto" }.Concat(Contracts.LanguageCodes) : Contracts.LanguageCodes).Select(c => new Language(c, c == "auto" ? Strings.Get("Auto") : new CultureInfo(c).DisplayName)).ToArray(),
        DisplayMemberPath = nameof(Language.Name), SelectedValuePath = nameof(Language.Code), MinWidth = 160
    };
    public static async Task Guard(FrameworkElement owner, Func<Task> action)
    {
        try { await action(); }
        catch (OperationCanceledException) { }
        catch (RunnerException error) { await Message(owner, ErrorText.Text(error.Error)); }
        catch (BackendException error) { await Message(owner, ErrorText.Text(new RunnerError.Backend(error))); }
        catch (ArgumentException) { await Message(owner, Strings.Get("Err_Invalid")); }
        catch (System.Text.Json.JsonException) { await Message(owner, Strings.Get("Err_Invalid")); }
        catch (IOException) { await Message(owner, Strings.Get("Err_Storage")); }
        catch (UnauthorizedAccessException) { await Message(owner, Strings.Get("Err_Storage")); }
    }
    public static Task<ContentDialogResult> Message(FrameworkElement owner, string text) => new ContentDialog { XamlRoot = owner.XamlRoot, Title = "ByoGlot", Content = new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap }, CloseButtonText = Strings.Get("Close") }.ShowAsync().AsTask();
    public sealed record Language(string Code, string Name);
}
