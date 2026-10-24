// Fixed local OCR helper. Run only through the qualified managed-runtime owner.
// No shell, file paths, credentials, downloads or diagnostic content.
using System;
using System.Collections.Generic;
using System.IO;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Windows.Data.Pdf;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

internal static class WindowsOcrHelper
{
    private const int SourceCap = 16777216, FrameCap = 23000000, ResultCap = 2097152;
    private const int Pixels = 4194304, Dimension = 4096, PageCap = 16;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = FrameCap, RecursionLimit = 16 };

    private static int Main()
    {
        try
        {
            // Include blocked input reads in the finite managed wait. A parent
            // native owner must still prove actual exit and all-member cleanup.
            var work = Task.Run((Func<Task<int>>)Run);
            if (!work.Wait(110000)) return 3;
            return work.Result;
        }
        catch { return 2; } // Never write source, recognized text or exception details.
    }

    private static void Need(bool value) { if (!value) throw new InvalidDataException(); }
    private static Dictionary<string, object> Request(byte[] bytes)
    {
        var text = new UTF8Encoding(false, true).GetString(bytes);
        const string language = "[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}";
        // Accept only the private writer's canonical field order and lexical
        // forms. Duplicate/escaped keys, whitespace or numeric aliases cannot
        // be silently repaired by a general JSON deserializer.
        var ready = Regex.Match(text, "\\A\\{\"version\":1,\"operation\":\"readiness\",\"language\":\"(" + language + ")\"\\}\\z", RegexOptions.CultureInvariant, TimeSpan.FromSeconds(5));
        if (ready.Success) return Record("operation", "readiness", "language", ready.Groups[1].Value);
        var match = Regex.Match(text, "\\A\\{\"version\":1,\"operation\":\"recognize\",\"language\":\"(" + language + ")\",\"mediaType\":\"(image/png|image/jpeg|application/pdf)\",\"source\":\"([A-Za-z0-9+/]+={0,2})\",\"pages\":\\[([1-9][0-9]{0,3}(?:,[1-9][0-9]{0,3}){0,15})\\]\\}\\z", RegexOptions.CultureInvariant, TimeSpan.FromSeconds(5));
        Need(match.Success);
        var pages = match.Groups[4].Value.Split(',').Select(v => Int32.Parse(v, NumberStyles.None, CultureInfo.InvariantCulture)).ToArray();
        return Record("operation", "recognize", "language", match.Groups[1].Value,
                      "mediaType", match.Groups[2].Value, "source", match.Groups[3].Value, "pages", pages);
    }
    private static byte[] ReadExactly(Stream input, int size)
    {
        var bytes = new byte[size]; int offset = 0;
        while (offset < size) { int read = input.Read(bytes, offset, size - offset); Need(read > 0); offset += read; }
        return bytes;
    }
    private static void Write(object value)
    {
        var bytes = new UTF8Encoding(false, true).GetBytes(Json.Serialize(value));
        Need(bytes.Length > 0 && bytes.Length <= ResultCap);
        using (var output = Console.OpenStandardOutput())
        { output.Write(BitConverter.GetBytes(bytes.Length), 0, 4); output.Write(bytes, 0, bytes.Length); output.Flush(); }
    }
    private static async Task<InMemoryRandomAccessStream> Memory(byte[] bytes)
    {
        var stream = new InMemoryRandomAccessStream();
        try
        {
            using (var writer = new DataWriter(stream))
            { writer.WriteBytes(bytes); await writer.StoreAsync(); writer.DetachStream(); }
            stream.Seek(0); return stream;
        }
        catch { stream.Dispose(); throw; }
    }
    private static Dictionary<string, object> Record(params object[] pairs)
    {
        var result = new Dictionary<string, object>();
        for (int i = 0; i < pairs.Length; i += 2) result.Add((string)pairs[i], pairs[i + 1]);
        return result;
    }
    private static async Task<int> Run()
    {
        Dictionary<string, object> request;
        using (var input = Console.OpenStandardInput())
        {
            var size = BitConverter.ToUInt32(ReadExactly(input, 4), 0);
            Need(size > 0 && size <= FrameCap);
            var bytes = ReadExactly(input, (int)size); Need(input.ReadByte() == -1);
            request = Request(bytes);
        }
        var operation = (string)request["operation"]; var language = (string)request["language"];
        Need(language.Length <= 35);
        var engine = OcrEngine.TryCreateFromLanguage(new Language(language));
        // Windows can resolve a requested tag to a different installed OCR
        // language. Never echo the requested identity for a substituted engine.
        if (engine == null || engine.RecognizerLanguage == null ||
            !String.Equals(engine.RecognizerLanguage.LanguageTag, language, StringComparison.Ordinal))
        {
            Write(Record("version", 1, "status", "unavailable", "provider", "windows", "providerVersion", "1", "language", language, "reason", "language-unavailable")); return 0;
        }
        if (operation == "readiness")
        { Write(Record("version", 1, "status", "ready", "provider", "windows", "providerVersion", "1", "language", language)); return 0; }
        var media = (string)request["mediaType"];
        Need(media == "image/png" || media == "image/jpeg" || media == "application/pdf");
        var source = Convert.FromBase64String((string)request["source"]);
        Need(source.Length > 0 && source.Length <= SourceCap);
        var pages = (int[])request["pages"]; Need(pages.Length > 0 && pages.Length <= PageCap);
        Need(pages[0] >= 1 && pages[pages.Length - 1] <= 5000 && pages.Zip(pages.Skip(1), (a, b) => a < b).All(v => v));
        Need(media == "application/pdf" || (pages.Length == 1 && pages[0] == 1));
        var recognized = new List<object>(); int sourceCount = 1, lines = 0, characters = 0;
        using (var stream = await Memory(source))
        {
            if (media == "application/pdf")
            {
                var pdf = await PdfDocument.LoadFromStreamAsync(stream);
                Need(!pdf.IsPasswordProtected && pdf.PageCount >= 1 && pdf.PageCount <= 5000);
                sourceCount = (int)pdf.PageCount; Need(pages[pages.Length - 1] <= sourceCount);
                foreach (var number in pages)
                {
                    using (var page = pdf.GetPage((uint)(number - 1)))
                    using (var rendered = new InMemoryRandomAccessStream())
                    {
                        var width = page.Size.Width; var height = page.Size.Height;
                        Need(!double.IsNaN(width) && !double.IsInfinity(width) && width > 0 && width <= 100000 && !double.IsNaN(height) && !double.IsInfinity(height) && height > 0 && height <= 100000);
                        var scale = Math.Min(2, Math.Min(Dimension / width, Math.Min(Dimension / height, Math.Sqrt(Pixels / (width * height)))));
                        var options = new PdfPageRenderOptions { DestinationWidth = (uint)Math.Max(1, Math.Floor(width * scale)), DestinationHeight = (uint)Math.Max(1, Math.Floor(height * scale)) };
                        Need((long)options.DestinationWidth * options.DestinationHeight <= Pixels);
                        await page.RenderToStreamAsync(rendered, options); Need(rendered.Size <= SourceCap); rendered.Seek(0);
                        var value = await Recognize(engine, rendered, "image/png", number);
                        Count(value, ref lines, ref characters); recognized.Add(value);
                    }
                }
            }
            else
            {
                var value = await Recognize(engine, stream, media, 1);
                Count(value, ref lines, ref characters); recognized.Add(value);
            }
        }
        string digest;
        using (var hash = SHA256.Create()) digest = BitConverter.ToString(hash.ComputeHash(source)).Replace("-", "").ToLowerInvariant();
        Write(Record("version", 1, "status", "recognized", "provider", "windows", "providerVersion", "1", "language", language, "sourceSha256", digest, "sourcePageCount", sourceCount, "pages", recognized));
        return 0;
    }
    private static void Count(Dictionary<string, object> page, ref int lines, ref int characters)
    {
        foreach (Dictionary<string, object> line in (List<object>)page["lines"])
        { lines++; characters += ScalarLength((string)line["text"]); Need(lines <= 4096 && characters <= 250000); }
    }
    private static int ScalarLength(string value)
    {
        int count = 0;
        for (int i = 0; i < value.Length; i++, count++)
        {
            var character = value[i];
            if (Char.IsHighSurrogate(character))
            { Need(i + 1 < value.Length && Char.IsLowSurrogate(value[i + 1])); i++; }
            else
            { Need(!Char.IsLowSurrogate(character) && (!Char.IsControl(character) || character == '\t')); }
        }
        return count;
    }
    private static async Task<Dictionary<string, object>> Recognize(OcrEngine engine, IRandomAccessStream stream, string media, int number)
    {
        var decoder = await BitmapDecoder.CreateAsync(stream);
        Need(decoder.DecoderInformation.CodecId == (media == "image/png" ? BitmapDecoder.PngDecoderId : BitmapDecoder.JpegDecoderId));
        Need(decoder.PixelWidth >= 1 && decoder.PixelHeight >= 1 && decoder.PixelWidth <= Dimension && decoder.PixelHeight <= Dimension && (ulong)decoder.PixelWidth * decoder.PixelHeight <= Pixels);
        Need(decoder.OrientedPixelWidth >= 1 && decoder.OrientedPixelHeight >= 1 && decoder.OrientedPixelWidth <= Dimension && decoder.OrientedPixelHeight <= Dimension && (ulong)decoder.OrientedPixelWidth * decoder.OrientedPixelHeight <= Pixels);
        using (var bitmap = await decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied,
            new BitmapTransform(), ExifOrientationMode.RespectExifOrientation, ColorManagementMode.DoNotColorManage))
        {
            // Recognition coordinates describe the viewed bitmap, not the stored
            // JPEG raster. EXIF quarter-turns swap the width and height.
            Need(bitmap.PixelWidth == decoder.OrientedPixelWidth && bitmap.PixelHeight == decoder.OrientedPixelHeight);
            var result = await engine.RecognizeAsync(bitmap); var lines = new List<object>();
            foreach (var line in result.Lines)
            {
                if (String.IsNullOrWhiteSpace(line.Text)) continue;
                Need(ScalarLength(line.Text) <= 250000 && line.Words.Count > 0 && lines.Count < 4096);
                double left = line.Words.Min(w => w.BoundingRect.Left), top = line.Words.Min(w => w.BoundingRect.Top);
                double right = line.Words.Max(w => w.BoundingRect.Right), bottom = line.Words.Max(w => w.BoundingRect.Bottom);
                Need(left >= 0 && top >= 0 && right > left && bottom > top && right <= bitmap.PixelWidth && bottom <= bitmap.PixelHeight);
                lines.Add(Record("text", line.Text, "left", left, "top", top, "width", right - left, "height", bottom - top));
            }
            return Record("number", number, "width", bitmap.PixelWidth, "height", bitmap.PixelHeight, "lines", lines);
        }
    }
}
