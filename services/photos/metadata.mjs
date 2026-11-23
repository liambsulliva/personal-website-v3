// What the index needs from a file: size, capture time, keywords.
import sharp from "sharp";

sharp.cache(false);
sharp.concurrency(1);

const FORMATS = new Set(["jpeg", "png", "webp", "tiff", "gif", "svg"]);

/** Throws when the bytes aren't a complete image we accept. */
export async function readMetadata(buffer) {
  const image = sharp(buffer, { failOn: "error", limitInputPixels: 120e6 });
  const meta = await image.metadata();
  if (!FORMATS.has(meta.format)) throw new Error(`unsupported format ${meta.format}`);
  // metadata() reads the header only; a truncated copy fails when it's decoded.
  await sharp(buffer, { failOn: "error", limitInputPixels: 120e6 }).resize(64, 64, { fit: "inside" }).raw().toBuffer();
  const { width, height } = meta.autoOrient ?? meta;
  const xmp = meta.xmp?.toString("utf8") ?? "";
  return {
    width,
    height,
    format: meta.format,
    takenAt: exifDate(meta.exif) ?? xmpDate(xmp),
    fileTags: [...new Set([...iptcKeywords(meta.iptc), ...xmpKeywords(xmp)])].sort(),
  };
}

const ISO = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}:\d{2}:\d{2})/;
const isoDate = (text) => {
  const m = ISO.exec(text ?? "");
  return m && Number(m[1]) > 1900 && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}` : null;
};

/** DateTimeOriginal (0x9003) from an EXIF block, in the camera's own time. */
export function exifDate(exif) {
  if (!exif) return null;
  try {
    const at = exif.toString("latin1", 0, 6) === "Exif\0\0" ? 6 : 0;
    const order = exif.toString("latin1", at, at + 2);
    if (order !== "II" && order !== "MM") return null;
    const u16 = (o) => (order === "II" ? exif.readUInt16LE(at + o) : exif.readUInt16BE(at + o));
    const u32 = (o) => (order === "II" ? exif.readUInt32LE(at + o) : exif.readUInt32BE(at + o));
    const find = (ifd, tag) => {
      for (let i = 0, n = u16(ifd); i < n; i++) if (u16(ifd + 2 + i * 12) === tag) return ifd + 2 + i * 12;
      return null;
    };
    const pointer = find(u32(4), 0x8769);
    const entry = pointer === null ? null : find(u32(pointer + 8), 0x9003);
    return entry === null ? null : isoDate(exif.toString("latin1", at + u32(entry + 8), at + u32(entry + 8) + 19));
  } catch {
    return null; // a malformed block reads past its end
  }
}

const xmpDate = (xmp) => isoDate(/exif:DateTimeOriginal(?:="|>)([^"<]+)/.exec(xmp)?.[1] ?? /photoshop:DateCreated(?:="|>)([^"<]+)/.exec(xmp)?.[1]);

const unescape = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name]);
const xmpKeywords = (xmp) => {
  const bag = /<dc:subject>([\s\S]*?)<\/dc:subject>/.exec(xmp)?.[1] ?? "";
  return [...bag.matchAll(/<rdf:li[^>]*>([^<]*)<\/rdf:li>/g)].map((m) => unescape(m[1]).trim()).filter(Boolean);
};

/** IPTC 2:25 records; sharp hands over the Photoshop block or the bare records. */
export function iptcKeywords(iptc) {
  const out = [];
  if (!iptc) return out;
  for (let i = 0; i + 5 <= iptc.length; i++) {
    if (iptc[i] !== 0x1c || iptc[i + 1] !== 2 || iptc[i + 2] !== 25) continue;
    const length = iptc.readUInt16BE(i + 3);
    if (length > 64 || i + 5 + length > iptc.length) continue;
    const word = iptc.toString("utf8", i + 5, i + 5 + length).trim();
    if (word) out.push(word);
    i += 4 + length;
  }
  return out;
}
