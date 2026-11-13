using ByoGlot.App.Services;
using ByoGlot.Core;
using ByoGlot.Core.Capture;

namespace ByoGlot.App.Shell;

public sealed class QuickCoordinator
{
    private readonly SelectionReader reader;
    private readonly QuickWindow window;
    private CancellationTokenSource? pending;
    private long nextRequest;
    private string appName = "";
    private string? template;
    public QuickState State { get; private set; } = new QuickState.Hidden();
    public QuickCoordinator(SelectionReader reader)
    {
        this.reader = reader;
        window = new QuickWindow();
        window.Dismissed += Dismiss;
        window.TemplateChanged += id => { template = id; var text = State switch { QuickState.Translating t => t.Source, QuickState.Done d => d.Source, QuickState.Failed f => f.Source, _ => null }; if (text is not null) Apply(new QuickEvent.Clipboard(new ClipboardRead.Text(text), Begin())); };
    }
    private long Begin() { pending?.Cancel(); pending = null; return ++nextRequest; }
    public async Task SelectionAsync()
    {
        var id = Begin();
        var selected = await window.SetTemplatesAsync(template);
        if (id != nextRequest) return;
        template = selected;
        var captureTask = reader.ReadAsync();
        var capturedAppName = reader.AppName;
        var capture = await captureTask;
        if (id != nextRequest) return;
        appName = capturedAppName;
        Apply(new QuickEvent.Captured(capture, id));
    }
    public async Task ClipboardAsync()
    {
        var id = Begin();
        var selected = await window.SetTemplatesAsync(template);
        if (id != nextRequest) return;
        template = selected;
        appName = "";
        Apply(new QuickEvent.Clipboard(ClipboardAccess.Read(InputLimits.Quick), id));
    }
    public void Dismiss() { Begin(); Apply(new QuickEvent.Dismissed()); }
    private void Apply(QuickEvent action)
    {
        var reduced = QuickReducer.Reduce(State, action); State = reduced.State;
        window.Render(State);
        if (reduced.StartTranslating is { } text && State is QuickState.Translating running) _ = TranslateAsync(text, running.RequestId);
    }
    private async Task TranslateAsync(string text, long id)
    {
        using var cancellation = new CancellationTokenSource(); pending = cancellation;
        try
        {
            var output = await AppServices.Current.Runner.TranslateAsync(new(text, InputLimits.Quick, AppName: appName, TemplateId: template), cancellation.Token);
            if (id == nextRequest) Apply(new QuickEvent.Finished(output, id));
        }
        catch (OperationCanceledException) { }
        catch (RunnerException error) { if (id == nextRequest) Apply(new QuickEvent.FailedWith(error.Error, id)); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { if (id == nextRequest) Apply(new QuickEvent.FailedWith(new RunnerError.Backend(new BackendException(ErrorKind.Offline)), id)); }
        finally { if (id == nextRequest) pending = null; }
    }
}
