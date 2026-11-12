using Microsoft.UI.Xaml;
using Windows.ApplicationModel.DataTransfer;

namespace ByoGlot.App;

public partial class App : Application
{
    public MainWindow Main { get; private set; } = null!;
    public App() => InitializeComponent();
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        Main = new MainWindow();
        Main.Activate();
    }
    public void ShowMain(string page = "Translate") { Main.Open(page); Main.Activate(); }
    public void Copy(string text)
    {
        var data = new DataPackage(); data.SetText(text); Clipboard.SetContent(data);
    }
}
