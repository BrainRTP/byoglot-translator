using System.Runtime.InteropServices;
using ByoGlot.Core.Capture;
using Windows.Win32;
using Windows.Win32.Foundation;

namespace ByoGlot.App.Shell;

public static class ClipboardAccess
{
    public static ClipboardRead ReadChanged(uint previous, uint current, int limit)
        => previous == current ? new ClipboardRead.Empty() : Read(limit, previous, current);

    public static ClipboardRead Read(int limit) => Read(limit, 0, 1);

    private static unsafe ClipboardRead Read(int limit, uint previous, uint current)
    {
        if (!PInvoke.OpenClipboard(default)) return new ClipboardRead.Empty();
        try
        {
            var names = new List<string>();
            foreach (var name in new[] { "ExcludeClipboardContentFromMonitorProcessing", "CanIncludeInClipboardHistory" })
                if (PInvoke.IsClipboardFormatAvailable(PInvoke.RegisterClipboardFormat(name))) names.Add(name);
            if (PInvoke.IsClipboardFormatAvailable(13)) names.Add("CF_UNICODETEXT");
            return ClipboardText.ReadChanged(previous, current, names, limit, () =>
            {
                var data = PInvoke.GetClipboardData(13);
                if (data.IsNull) return null;
                var global = new HGLOBAL(data.Value);
                var pointer = (char*)PInvoke.GlobalLock(global);
                if (pointer is null) return null;
                try
                {
                    var count = (int)Math.Min((nuint)(limit + 1), PInvoke.GlobalSize(global) / 2);
                    var length = 0;
                    while (length < count && pointer[length] != '\0') length++;
                    return new string(pointer, 0, length);
                }
                finally { PInvoke.GlobalUnlock(global); }
            });
        }
        finally { PInvoke.CloseClipboard(); }
    }
}
