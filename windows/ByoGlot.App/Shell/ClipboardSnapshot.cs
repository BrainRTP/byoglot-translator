using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Security.Cryptography;
using ByoGlot.Core.Capture;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.System.Memory;
using Windows.Win32.System.Ole;

namespace ByoGlot.App.Shell;

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public sealed class ClipboardSnapshot : IDataObject, IClipboardSnapshot
{
    private const int Limit = 64 * 1024 * 1024;
    private const int FormatError = unchecked((int)0x80040064);
    private const int NoAdvise = unchecked((int)0x80040003);
    private readonly List<Entry> entries = [];
    private int references = 1;
    private int disposed;
    internal IDisposable Retain()
    {
        Interlocked.Increment(ref references);
        return new Lease(this);
    }
    private sealed class Lease(ClipboardSnapshot snapshot) : IDisposable
    {
        private ClipboardSnapshot? value = snapshot;
        public void Dispose() => Interlocked.Exchange(ref value, null)?.ReleaseReference();
    }
    private void ReleaseReference() { if (Interlocked.Decrement(ref references) == 0) FreeEntries(); }

    private sealed class Entry(FORMATETC format, byte[]? bytes, STGMEDIUM native) : IDisposable
    {
        public FORMATETC Format { get; } = format;
        public byte[]? Bytes { get; } = bytes;
        private STGMEDIUM native = native;
        public unsafe STGMEDIUM Materialize(TYMED requested)
        {
            if (Bytes is null)
            {
                var duplicate = PInvoke.OleDuplicateData(new HANDLE(native.unionmember), (CLIPBOARD_FORMAT)unchecked((ushort)Format.cfFormat), 0);
                if (duplicate.IsNull) throw new COMException("Clipboard format could not be copied.");
                return new() { tymed = native.tymed, unionmember = (nint)duplicate.Value };
            }
            var global = Allocate(Bytes);
            if ((requested & TYMED.TYMED_HGLOBAL) != 0) return new() { tymed = TYMED.TYMED_HGLOBAL, unionmember = (nint)global.Value };
            var status = PInvoke.CreateStreamOnHGlobal(global, true, out var stream);
            if (status.Failed) { PInvoke.GlobalFree(global); throw new COMException("Clipboard stream could not be created.", status.Value); }
            try { return new() { tymed = TYMED.TYMED_ISTREAM, unionmember = StreamPointer(stream) }; }
            finally { Marshal.ReleaseComObject(stream); }
        }
        public void Dispose()
        {
            if (Bytes is not null) CryptographicOperations.ZeroMemory(Bytes);
            if (native.tymed != TYMED.TYMED_NULL) { Release(ref native); native = default; }
        }
    }

    public static unsafe ClipboardSnapshot? Capture(IDataObject source, Func<bool>? canRead = null)
    {
        var snapshot = new ClipboardSnapshot();
        IEnumFORMATETC? formats = null;
        try
        {
            formats = source.EnumFormatEtc(DATADIR.DATADIR_GET);
            var next = new FORMATETC[1];
            var fetched = new int[1];
            long total = 0;
            while (true)
            {
                var status = formats.Next(1, next, fetched);
                if (status == 1 && fetched[0] == 0) break;
                if (status != 0 || fetched[0] != 1) throw new COMException("Clipboard formats could not be enumerated.");
                var format = next[0];
                try
                {
                    if (format.ptd != IntPtr.Zero || format.lindex != -1 || format.dwAspect != DVASPECT.DVASPECT_CONTENT || unchecked((ushort)format.cfFormat) is >= 0x0200 and <= 0x02ff || canRead?.Invoke() == false) throw new COMException("Clipboard snapshot is unavailable.");
                    format.tymed &= TYMED.TYMED_HGLOBAL | TYMED.TYMED_ISTREAM | TYMED.TYMED_GDI | TYMED.TYMED_MFPICT | TYMED.TYMED_ENHMF;
                    if (format.tymed == TYMED.TYMED_NULL) throw new COMException("Clipboard format is unsupported.");
                    source.GetData(ref format, out var medium);
                    try
                    {
                        if (canRead?.Invoke() == false) throw new COMException("Clipboard snapshot is unavailable.");
                        byte[]? bytes = medium.tymed switch
                        {
                            TYMED.TYMED_HGLOBAL => ReadGlobal(medium.unionmember),
                            TYMED.TYMED_ISTREAM => ReadStream(medium.unionmember),
                            _ => null
                        };
                        STGMEDIUM clone = default;
                        if (bytes is not null)
                        {
                            total += bytes.Length;
                            if (total > Limit) throw new COMException("Clipboard snapshot is too large.");
                            format.tymed = TYMED.TYMED_HGLOBAL | TYMED.TYMED_ISTREAM;
                        }
                        else
                        {
                            if (medium.tymed is not (TYMED.TYMED_GDI or TYMED.TYMED_MFPICT or TYMED.TYMED_ENHMF)) throw new COMException("Clipboard format is unsupported.");
                            var data = PInvoke.OleDuplicateData(new HANDLE(medium.unionmember), (CLIPBOARD_FORMAT)unchecked((ushort)format.cfFormat), 0);
                            if (data.IsNull) throw new COMException("Clipboard format could not be copied.");
                            clone = new() { tymed = medium.tymed, unionmember = (nint)data.Value };
                            format.tymed = medium.tymed;
                        }
                        snapshot.entries.Add(new(format, bytes, clone));
                    }
                    finally { Release(ref medium); }
                }
                finally { if (format.ptd != IntPtr.Zero) Marshal.FreeCoTaskMem(format.ptd); }
            }
            snapshot.ExcludeHistory();
            return snapshot;
        }
        catch (Exception error) when (error is COMException or IOException or OverflowException)
        {
            snapshot.Dispose();
            return null;
        }
        finally { if (formats is not null && Marshal.IsComObject(formats)) Marshal.ReleaseComObject(formats); }
    }

    private void ExcludeHistory()
    {
        foreach (var name in new[] { "CanIncludeInClipboardHistory", "CanUploadToCloudClipboard" })
        {
            var id = unchecked((short)PInvoke.RegisterClipboardFormat(name));
            foreach (var old in entries.Where(e => e.Format.cfFormat == id).ToArray()) { old.Dispose(); entries.Remove(old); }
            entries.Add(new(new() { cfFormat = id, dwAspect = DVASPECT.DVASPECT_CONTENT, lindex = -1, tymed = TYMED.TYMED_HGLOBAL }, new byte[4], default));
        }
        var own = unchecked((short)PInvoke.RegisterClipboardFormat(ClipboardAccess.OwnFormat));
        foreach (var old in entries.Where(e => e.Format.cfFormat == own).ToArray()) { old.Dispose(); entries.Remove(old); }
        entries.Add(new(new() { cfFormat = own, dwAspect = DVASPECT.DVASPECT_CONTENT, lindex = -1, tymed = TYMED.TYMED_HGLOBAL }, ClipboardAccess.OwnMarker.ToArray(), default));
    }

    public static ClipboardSnapshot Text(string text)
    {
        var snapshot = new ClipboardSnapshot();
        snapshot.entries.Add(new(new() { cfFormat = 13, dwAspect = DVASPECT.DVASPECT_CONTENT, lindex = -1, tymed = TYMED.TYMED_HGLOBAL }, System.Text.Encoding.Unicode.GetBytes(text + '\0'), default));
        snapshot.ExcludeHistory();
        return snapshot;
    }

    internal unsafe ClipboardRestoreResult Publish(HWND owner, Func<ClipboardRestoreResult>? validate = null, CancellationToken cancellation = default)
    {
        var prepared = new List<(uint Format, STGMEDIUM Medium)>();
        try
        {
            foreach (var entry in entries.DistinctBy(e => e.Format.cfFormat))
                prepared.Add((unchecked((ushort)entry.Format.cfFormat), entry.Materialize(entry.Bytes is null ? entry.Format.tymed : TYMED.TYMED_HGLOBAL)));
            if (cancellation.IsCancellationRequested || !PInvoke.OpenClipboard(owner)) return ClipboardRestoreResult.Failed;
            try
            {
                var valid = validate?.Invoke() ?? ClipboardRestoreResult.Restored;
                if (valid != ClipboardRestoreResult.Restored) return valid;
                if (cancellation.IsCancellationRequested || !PInvoke.EmptyClipboard()) return ClipboardRestoreResult.Failed;
                for (var i = 0; i < prepared.Count; i++)
                {
                    var item = prepared[i];
                    if (PInvoke.SetClipboardData(item.Format, new HANDLE(item.Medium.unionmember)).IsNull) return ClipboardRestoreResult.Failed;
                    prepared[i] = (item.Format, default);
                }
                ClipboardAccess.MarkOwn();
                return ClipboardRestoreResult.Restored;
            }
            finally { PInvoke.CloseClipboard(); }
        }
        catch (COMException) { return ClipboardRestoreResult.Failed; }
        finally
        {
            foreach (var item in prepared) { var medium = item.Medium; if (medium.tymed != TYMED.TYMED_NULL) Release(ref medium); }
        }
    }

    internal static unsafe HGLOBAL Allocate(byte[] bytes)
    {
        var global = PInvoke.GlobalAlloc(GLOBAL_ALLOC_FLAGS.GMEM_MOVEABLE | GLOBAL_ALLOC_FLAGS.GMEM_ZEROINIT, (nuint)Math.Max(bytes.Length, 1));
        if (global.IsNull) throw new COMException("Clipboard allocation failed.");
        var pointer = PInvoke.GlobalLock(global);
        if (pointer is null) { PInvoke.GlobalFree(global); throw new COMException("Clipboard allocation failed."); }
        try { Marshal.Copy(bytes, 0, (nint)pointer, bytes.Length); }
        finally { PInvoke.GlobalUnlock(global); }
        return global;
    }
    private static unsafe byte[] ReadGlobal(nint value)
    {
        var global = new HGLOBAL(value);
        var size = PInvoke.GlobalSize(global);
        if (size > Limit) throw new COMException("Clipboard snapshot is too large.");
        var pointer = PInvoke.GlobalLock(global);
        if (pointer is null) throw new COMException("Clipboard format could not be read.");
        try { var bytes = new byte[(int)size]; Marshal.Copy((nint)pointer, bytes, 0, bytes.Length); return bytes; }
        finally { PInvoke.GlobalUnlock(global); }
    }
    private static byte[] ReadStream(nint pointer)
    {
        var stream = (IStream)Marshal.GetObjectForIUnknown(pointer);
        var count = Marshal.AllocCoTaskMem(sizeof(int));
        try
        {
            stream.Seek(0, 0, IntPtr.Zero);
            using var output = new MemoryStream();
            var buffer = new byte[8192];
            while (true)
            {
                stream.Read(buffer, buffer.Length, count);
                var read = Marshal.ReadInt32(count);
                if (read == 0) return output.ToArray();
                if (read < 0 || read > buffer.Length || output.Length + read > Limit) throw new COMException("Clipboard snapshot is too large.");
                output.Write(buffer, 0, read);
            }
        }
        finally { Marshal.FreeCoTaskMem(count); Marshal.ReleaseComObject(stream); }
    }
    public static void Release(ref STGMEDIUM medium)
    {
        var native = new Windows.Win32.System.Com.STGMEDIUM { tymed = (Windows.Win32.System.Com.TYMED)medium.tymed, u = new() { hGlobal = new(medium.unionmember) }, pUnkForRelease = medium.pUnkForRelease! };
        PInvoke.ReleaseStgMedium(ref native);
        medium = default;
    }
    internal static nint StreamPointer(object stream)
    {
        var unknown = Marshal.GetIUnknownForObject(stream);
        try
        {
            var id = typeof(IStream).GUID;
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(unknown, in id, out var pointer));
            return pointer;
        }
        finally { Marshal.Release(unknown); }
    }
    private Entry? Find(FORMATETC format) => entries.FirstOrDefault(e => e.Format.cfFormat == format.cfFormat && e.Format.dwAspect == format.dwAspect && e.Format.lindex == format.lindex && (e.Format.tymed & format.tymed) != 0);
    public void GetData(ref FORMATETC format, out STGMEDIUM medium) => medium = (Find(format) ?? throw new COMException("Clipboard format is unavailable.", FormatError)).Materialize(format.tymed);
    public int QueryGetData(ref FORMATETC format) => Find(format) is null ? FormatError : 0;
    public IEnumFORMATETC EnumFormatEtc(DATADIR direction) => direction == DATADIR.DATADIR_GET ? new FormatEnumerator(entries.Select(e => e.Format).ToArray()) : throw new COMException("Clipboard direction is unsupported.");
    public void GetDataHere(ref FORMATETC format, ref STGMEDIUM medium) => throw new COMException("Clipboard operation is unsupported.");
    public int GetCanonicalFormatEtc(ref FORMATETC input, out FORMATETC output) { output = input; output.ptd = IntPtr.Zero; return 0x40130; }
    public void SetData(ref FORMATETC format, ref STGMEDIUM medium, bool release) => throw new COMException("Clipboard snapshot is read-only.");
    public int DAdvise(ref FORMATETC format, ADVF flags, IAdviseSink sink, out int connection) { connection = 0; return NoAdvise; }
    public void DUnadvise(int connection) => throw new COMException("Clipboard advice is unsupported.", NoAdvise);
    public int EnumDAdvise(out IEnumSTATDATA enumerator) { enumerator = null!; return NoAdvise; }
    public override string ToString() => "ClipboardSnapshot { [redacted] }";
    public void Dispose() { if (Interlocked.Exchange(ref disposed, 1) == 0) ReleaseReference(); GC.SuppressFinalize(this); }
    private void FreeEntries() { foreach (var entry in entries) entry.Dispose(); entries.Clear(); }
    ~ClipboardSnapshot() => FreeEntries();
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public sealed class FormatEnumerator(FORMATETC[] formats) : IEnumFORMATETC
{
    private int index;
    public int Next(int count, FORMATETC[] result, int[] fetched)
    {
        var read = 0;
        while (read < count && index < formats.Length) result[read++] = formats[index++];
        if (fetched is { Length: > 0 }) fetched[0] = read;
        return read == count ? 0 : 1;
    }
    public int Skip(int count) { var next = Math.Min(index + count, formats.Length); var skipped = next - index; index = next; return skipped == count ? 0 : 1; }
    public int Reset() { index = 0; return 0; }
    public void Clone(out IEnumFORMATETC clone) => clone = new FormatEnumerator(formats) { index = index };
}
