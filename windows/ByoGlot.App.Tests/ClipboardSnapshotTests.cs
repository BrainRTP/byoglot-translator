using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using ByoGlot.App.Shell;
using Windows.Win32;
using Windows.Win32.Foundation;

namespace ByoGlot.App.Tests;

public class ClipboardSnapshotTests
{
    private sealed class Source(bool stream) : IDataObject
    {
        public byte[] Bytes { get; set; } = [1, 2, 3, 4];
        public FORMATETC Format => new() { cfFormat = stream ? unchecked((short)PInvoke.RegisterClipboardFormat("ByoGlot snapshot test stream")) : (short)13, dwAspect = DVASPECT.DVASPECT_CONTENT, lindex = -1, tymed = stream ? TYMED.TYMED_ISTREAM : TYMED.TYMED_HGLOBAL };
        public unsafe void GetData(ref FORMATETC format, out STGMEDIUM medium)
        {
            var global = ClipboardSnapshot.Allocate(Bytes);
            medium = new() { tymed = TYMED.TYMED_HGLOBAL, unionmember = (nint)global.Value };
            if (!stream) return;
            var status = PInvoke.CreateStreamOnHGlobal(global, true, out var value);
            Assert.True(status.Succeeded);
            try { medium = new() { tymed = TYMED.TYMED_ISTREAM, unionmember = Marshal.GetIUnknownForObject(value) }; }
            finally { Marshal.ReleaseComObject(value); }
        }
        public IEnumFORMATETC EnumFormatEtc(DATADIR direction) => new FormatEnumerator([Format]);
        public int QueryGetData(ref FORMATETC format) => 0;
        public void GetDataHere(ref FORMATETC format, ref STGMEDIUM medium) => throw new NotSupportedException();
        public int GetCanonicalFormatEtc(ref FORMATETC input, out FORMATETC output) { output = input; return 0x40130; }
        public void SetData(ref FORMATETC format, ref STGMEDIUM medium, bool release) => throw new NotSupportedException();
        public int DAdvise(ref FORMATETC format, ADVF flags, IAdviseSink sink, out int connection) { connection = 0; return -1; }
        public void DUnadvise(int connection) => throw new NotSupportedException();
        public int EnumDAdvise(out IEnumSTATDATA enumerator) { enumerator = null!; return -1; }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public unsafe void SnapshotMaterializesDataBeforeTheSourceChanges(bool stream)
    {
        var source = new Source(stream);
        using var snapshot = ClipboardSnapshot.Capture(source);
        Assert.NotNull(snapshot);
        source.Bytes = [9, 8, 7, 6];
        var format = source.Format;
        format.tymed = TYMED.TYMED_HGLOBAL;
        snapshot.GetData(ref format, out var medium);
        try
        {
            var global = new HGLOBAL(medium.unionmember);
            var pointer = PInvoke.GlobalLock(global);
            try { var bytes = new byte[4]; Marshal.Copy((nint)pointer, bytes, 0, bytes.Length); Assert.Equal(new byte[] { 1, 2, 3, 4 }, bytes); }
            finally { PInvoke.GlobalUnlock(global); }
        }
        finally { ClipboardSnapshot.Release(ref medium); }
        foreach (var name in new[] { "CanIncludeInClipboardHistory", "CanUploadToCloudClipboard" })
        {
            format = new() { cfFormat = unchecked((short)PInvoke.RegisterClipboardFormat(name)), dwAspect = DVASPECT.DVASPECT_CONTENT, lindex = -1, tymed = TYMED.TYMED_HGLOBAL };
            snapshot.GetData(ref format, out medium);
            try
            {
                var global = new HGLOBAL(medium.unionmember);
                var pointer = PInvoke.GlobalLock(global);
                try { Assert.Equal(0, Marshal.ReadInt32((nint)pointer)); }
                finally { PInvoke.GlobalUnlock(global); }
            }
            finally { ClipboardSnapshot.Release(ref medium); }
        }
    }
}
