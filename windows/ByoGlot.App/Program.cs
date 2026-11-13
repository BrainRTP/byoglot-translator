using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using Windows.Win32;

namespace ByoGlot.App;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        WinRT.ComWrappersSupport.InitializeComWrappers();
        var instance = AppInstance.FindOrRegisterForKey("ByoGlot");
        if (!instance.IsCurrent)
        {
            Task.Run(async () => await instance.RedirectActivationToAsync(AppInstance.GetCurrent().GetActivatedEventArgs())).GetAwaiter().GetResult();
            return;
        }
        var ole = PInvoke.OleInitialize();
        if (ole.Failed) throw new System.Runtime.InteropServices.COMException("OLE initialization failed.", ole.Value);
        try
        {
            Application.Start(args =>
            {
                SynchronizationContext.SetSynchronizationContext(new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread()));
                _ = new App();
            });
        }
        finally { PInvoke.OleUninitialize(); }
    }
}
