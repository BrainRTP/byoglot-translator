using ByoGlot.Core;
using ByoGlot.App.Services;

namespace ByoGlot.App.ViewModels;

public sealed class MainViewModel : ObservableObject
{
    public MainState State { get; } = new(AppServices.Current.Runner, AppServices.Current.Settings);
    private string text = "";
    public string Text { get => text; set { text = value; Notify(); } }
    public EditorSelection? Selection { get; set; }
    public MainViewModel() => State.Changed += () => Notify(nameof(State));
}
