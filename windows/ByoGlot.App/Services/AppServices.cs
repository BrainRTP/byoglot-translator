using ByoGlot.Core;
using Windows.Storage;

namespace ByoGlot.App.Services;

public sealed class AppServices
{
    public static AppServices Current { get; } = new();
    public ISettingsRepository Settings { get; }
    public ISecretStore Secrets { get; }
    public HttpClientTransport Transport { get; } = new();
    public TranslationRunner Runner { get; }
    public ConnectionEditor Editor { get; }
    private AppServices()
    {
        var folder = ApplicationData.Current.LocalFolder.Path;
        Settings = new FileSettingsRepository(Path.Combine(folder, "settings.json"));
        Secrets = new DpapiSecretStore(Path.Combine(folder, "secrets.json"));
        Runner = new(Settings, Secrets, Transport);
        Editor = new(Settings, Secrets, Transport);
    }
}
