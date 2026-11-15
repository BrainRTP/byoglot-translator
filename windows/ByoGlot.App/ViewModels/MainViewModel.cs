using ByoGlot.Core;

namespace ByoGlot.App.ViewModels;

public sealed class MainViewModel : ObservableObject
{
    public MainState State { get; }
    private string text = "";
    public string Text { get => text; set { if (text == value) return; InvalidateResult(); text = value; Notify(); } }
    public EditorSelection? Selection { get; set; }
    public MainViewModel(MainState state) { State = state; State.Changed += () => Notify(nameof(State)); }
    public void InvalidateResult() { if (State.Phase is not TranslatePhase.Idle) State.Cancel(); }
}
