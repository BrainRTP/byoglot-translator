using System.Runtime.InteropServices;
using System.Security.Cryptography;
using ByoGlot.Core.Capture;
using Windows.Win32;
using Windows.Win32.Foundation;

namespace ByoGlot.App.Shell;

public static class ClipboardAccess
{
    public const string OwnFormat = "ByoGlot.Own";
    internal static byte[] OwnMarker { get; } = RandomNumberGenerator.GetBytes(16);
    internal static ClipboardOwnWrites OwnWrites { get; } = new();
    private static readonly string[] Exclusions = ["ExcludeClipboardContentFromMonitorProcessing", "CanIncludeInClipboardHistory"];
    public static ClipboardVersion Current
    {
        get
        {
            if (!PInvoke.OpenClipboard(default)) return Version(false);
            try { return Version(true); }
            finally { PInvoke.CloseClipboard(); }
        }
    }
    internal static unsafe ClipboardVersion Version(bool canOpen)
    {
        var owner = PInvoke.GetClipboardOwner();
        uint process = 0;
        if (!owner.IsNull) PInvoke.GetWindowThreadProcessId(owner, &process);
        return new(PInvoke.GetClipboardSequenceNumber(), (long)(nint)owner.Value, process, canOpen);
    }
    public static bool IsOurProcessOwner => Version(false).ProcessId == (uint)Environment.ProcessId;
    internal static void MarkOwn()
    {
        var version = Version(false);
        OwnWrites.Ignore(version.Sequence, version.Owner);
    }
    public static bool IsExcluded
    {
        get
        {
            var version = Version(false);
            var marker = false;
            if (version.ProcessId == (uint)Environment.ProcessId && PInvoke.OpenClipboard(default))
            {
                try { marker = HasOwnMarker(); version = Version(true); }
                finally { PInvoke.CloseClipboard(); }
            }
            return OwnWrites.IsExcluded(version.Sequence, version.Owner, marker, Exclusions.Where(Available).ToArray());
        }
    }
    private static bool Available(string name) => PInvoke.IsClipboardFormatAvailable(PInvoke.RegisterClipboardFormat(name));
    private static unsafe bool HasOwnMarker()
    {
        if (!Available(OwnFormat)) return false;
        var data = PInvoke.GetClipboardData(PInvoke.RegisterClipboardFormat(OwnFormat));
        if (data.IsNull) return false;
        var global = new HGLOBAL(data.Value);
        if (PInvoke.GlobalSize(global) < (nuint)OwnMarker.Length) return false;
        var pointer = PInvoke.GlobalLock(global);
        if (pointer is null) return false;
        try { return new ReadOnlySpan<byte>(pointer, OwnMarker.Length).SequenceEqual(OwnMarker); }
        finally { PInvoke.GlobalUnlock(global); }
    }
    public static ClipboardRead ReadChanged(uint previous, uint current, int limit)
        => previous == current ? new ClipboardRead.Empty() : Read(limit, previous, current);

    public static ClipboardRead Read(int limit) => ReadCurrent(limit)?.Read ?? new ClipboardRead.Empty();

    private static unsafe ClipboardRead Read(int limit, uint previous, uint current)
    {
        return previous == current ? new ClipboardRead.Empty() : Read(limit);
    }
    public static ClipboardContent? ReadCurrent(int limit)
    {
        if (!PInvoke.OpenClipboard(default)) return null;
        try { return ReadLocked(limit); }
        finally { PInvoke.CloseClipboard(); }
    }
    internal static unsafe ClipboardContent? ReadLocked(int limit)
    {
        var version = Version(true);
        var own = OwnWrites.IsOwn(version.Sequence, version.Owner, version.ProcessId == (uint)Environment.ProcessId && HasOwnMarker());
        var excluded = OwnWrites.IsExcluded(version.Sequence, version.Owner, own, Exclusions.Where(Available).ToArray());
        if (excluded) return new(version, new(version.Owner, version.ProcessId, "private"), new ClipboardRead.Concealed());
        uint format = 0;
        foreach (var candidate in new uint[] { 13, 17, 8, 15 }) if (PInvoke.IsClipboardFormatAvailable(candidate)) { format = candidate; break; }
        if (format == 0)
        {
            for (var next = PInvoke.EnumClipboardFormats(0); next != 0; next = PInvoke.EnumClipboardFormats(next))
            {
                if (new[] { OwnFormat, "CanIncludeInClipboardHistory", "CanUploadToCloudClipboard" }.Any(name => next == PInvoke.RegisterClipboardFormat(name))) continue;
                format = next;
                break;
            }
        }
        if (format == 0) return new(version, new(version.Owner, version.ProcessId, "empty"), new ClipboardRead.Empty());
        var data = PInvoke.GetClipboardData(format);
        if (data.IsNull) return null;
        var rendered = Version(true);
        var renderedOwn = OwnWrites.IsOwn(rendered.Sequence, rendered.Owner, rendered.ProcessId == (uint)Environment.ProcessId && HasOwnMarker());
        if (OwnWrites.IsExcluded(rendered.Sequence, rendered.Owner, renderedOwn, Exclusions.Where(Available).ToArray()))
            return new(rendered, new(rendered.Owner, rendered.ProcessId, "private"), new ClipboardRead.Concealed());
        var global = new HGLOBAL(data.Value);
        var size = PInvoke.GlobalSize(global);
        if (size == 0 || size > 64 * 1024 * 1024) return null;
        var pointer = PInvoke.GlobalLock(global);
        if (pointer is null) return null;
        try
        {
            var bytes = new ReadOnlySpan<byte>(pointer, (int)size);
            ClipboardRead read = new ClipboardRead.Empty();
            if (format == 13)
            {
                var text = new ReadOnlySpan<char>(pointer, (int)size / 2);
                var end = text.IndexOf('\0');
                if (end >= 0) text = text[..end];
                bytes = MemoryMarshal.AsBytes(text);
                if (text.Length > limit) read = new ClipboardRead.TooLong(limit);
                else { var raw = new string(text); read = ClipboardText.Read(new[] { "CF_UNICODETEXT" }, limit, () => raw); }
            }
            var fingerprint = format.ToString(System.Globalization.CultureInfo.InvariantCulture) + ":" + Convert.ToHexString(SHA256.HashData(bytes));
            var after = Version(true);
            if (after.Owner != version.Owner || after.ProcessId != version.ProcessId) return null;
            return new(after, new(after.Owner, after.ProcessId, fingerprint), read);
        }
        finally { PInvoke.GlobalUnlock(global); }
    }
}
