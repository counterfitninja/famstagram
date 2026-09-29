import { DOMParser } from "@xmldom/xmldom";
import ExifReader from "exifreader";

const xmlParser = new DOMParser();

export interface GpsCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Extracts GPS latitude and longitude from an image buffer or ArrayBuffer.
 * Returns null if no GPS tags exist or coordinates are invalid.
 */
type GpsParseResult = {
  coordinates: GpsCoordinates | null;
  source?: "expanded" | "exif" | "xmp" | "raw-exif" | "xmp-raw";
  error?: string;
};

async function parseGpsCoordinates(
  buffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<GpsParseResult> {
  try {
    let arrayBuffer: ArrayBuffer | SharedArrayBuffer;
    if (buffer instanceof ArrayBuffer || buffer instanceof SharedArrayBuffer) {
      arrayBuffer = buffer;
    } else if (ArrayBuffer.isView(buffer)) {
      arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
    } else {
      return { coordinates: null, error: "unsupported-buffer" };
    }

    const tags = ExifReader.load(arrayBuffer, {
      expanded: true,
      domParser: xmlParser,
    }) as unknown as Record<string, any>;

    // ExifReader's expanded GPS group is the most reliable representation.
    const expandedGps = tags.gps;
    const expandedLatitude = parseCoordinateTag(expandedGps?.Latitude);
    const expandedLongitude = parseCoordinateTag(expandedGps?.Longitude);
    if (expandedLatitude !== null && expandedLongitude !== null) {
      return { coordinates: toGpsCoordinates(expandedLatitude, expandedLongitude), source: "expanded" };
    }

    // In expanded mode the raw EXIF tags live under tags.exif (not at the root).
    // ExifReader normally uses GPSLatitude/GPSLongitude, but some versions and
    // camera exporters expose human-readable keys such as "GPS Latitude".
    // Some camera apps also omit the reference tags, so parse the raw values too.
    const exifTags = tags.exif ?? tags;
    const latitudeTag = findMetadataTag(exifTags, "gpslatitude");
    const longitudeTag = findMetadataTag(exifTags, "gpslongitude");
    const latitudeRefTag = findMetadataTag(exifTags, "gpslatituderef");
    const longitudeRefTag = findMetadataTag(exifTags, "gpslongituderef");
    const latitude = parseCoordinateTag(latitudeTag, readReference(latitudeRefTag));
    const longitude = parseCoordinateTag(longitudeTag, readReference(longitudeRefTag));
    if (latitude !== null && longitude !== null) {
      return { coordinates: toGpsCoordinates(latitude, longitude), source: "exif" };
    }

    // A number of mobile/photo apps store GPS in XMP rather than the EXIF GPS IFD.
    const xmpTags = tags.xmp ?? {};
    const xmpLatitudeTag = findMetadataTag(xmpTags, "gpslatitude");
    const xmpLongitudeTag = findMetadataTag(xmpTags, "gpslongitude");
    const xmpLatitudeRefTag = findMetadataTag(xmpTags, "gpslatituderef");
    const xmpLongitudeRefTag = findMetadataTag(xmpTags, "gpslongituderef");
    const xmpLatitude = parseCoordinateTag(
      xmpLatitudeTag,
      readReference(xmpLatitudeRefTag),
    );
    const xmpLongitude = parseCoordinateTag(
      xmpLongitudeTag,
      readReference(xmpLongitudeRefTag),
    );
    if (xmpLatitude !== null && xmpLongitude !== null) {
      return { coordinates: toGpsCoordinates(xmpLatitude, xmpLongitude), source: "xmp" };
    }

    // Some phone libraries include valid EXIF/XMP packets that ExifReader
    // cannot expose (for example, when the GPS IFD has an unusual layout).
    // Read those packets directly before giving up on the upload.
    const rawExifCoordinates = extractRawExifGps(arrayBuffer);
    if (rawExifCoordinates) {
      return { coordinates: rawExifCoordinates, source: "raw-exif" };
    }
    const rawXmpCoordinates =
      extractRawXmpGpsFromJpeg(arrayBuffer) ?? extractRawXmpGps(xmpTags?._raw);
    if (rawXmpCoordinates) {
      return { coordinates: rawXmpCoordinates, source: "xmp-raw" };
    }

    return { coordinates: null };
  } catch (error) {
    // If image format has no EXIF or is corrupt, fail gracefully.
    return {
      coordinates: null,
      error: error instanceof Error ? error.message.slice(0, 160) : "parse-failed",
    };
  }
}

export async function extractGpsCoordinates(
  buffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<GpsCoordinates | null> {
  return (await parseGpsCoordinates(buffer)).coordinates;
}

export interface GpsFileDiagnostics {
  index: number;
  type: string;
  size: number;
  coordinatesFound: boolean;
  source?: GpsParseResult["source"];
  error?: string;
}

export async function extractFirstGpsCoordinatesWithDiagnostics(files: readonly File[]): Promise<{
  coordinates: GpsCoordinates | null;
  files: GpsFileDiagnostics[];
}> {
  const diagnostics: GpsFileDiagnostics[] = [];
  for (const [index, file] of files.entries()) {
    try {
      // Do not trust the browser-provided MIME type here. Mobile share
      // providers sometimes label HEIC/JPEG photos as video/mp4; the parser
      // safely returns null for actual videos and unsupported files.
      const result = await parseGpsCoordinates(await file.arrayBuffer());
      diagnostics.push({
        index,
        type: file.type,
        size: file.size,
        coordinatesFound: result.coordinates !== null,
        source: result.source,
        error: result.error,
      });
      if (result.coordinates) return { coordinates: result.coordinates, files: diagnostics };
    } catch (error) {
      diagnostics.push({
        index,
        type: file.type,
        size: file.size,
        coordinatesFound: false,
        error: error instanceof Error ? error.message.slice(0, 160) : "read-failed",
      });
    }
  }
  return { coordinates: null, files: diagnostics };
}

/** Extracts the first valid GPS location from a post's uploaded media. */
export async function extractFirstGpsCoordinates(files: readonly File[]): Promise<GpsCoordinates | null> {
  return (await extractFirstGpsCoordinatesWithDiagnostics(files)).coordinates;
}

function toGpsCoordinates(latitude: number, longitude: number): GpsCoordinates | null {
  if (!isValidCoordinate(latitude, longitude)) return null;
  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
  };
}

function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function readReference(refTag: any): string | undefined {
  const value = refTag?.value ?? refTag?.description;
  const text = Array.isArray(value)
    ? value.join("").trim().toUpperCase()
    : typeof value === "string"
      ? value.trim().toUpperCase()
      : "";
  if (text.startsWith("S") || text.includes("SOUTH")) return "S";
  if (text.startsWith("W") || text.includes("WEST")) return "W";
  if (text.startsWith("N") || text.includes("NORTH")) return "N";
  if (text.startsWith("E") || text.includes("EAST")) return "E";
  return undefined;
}

function parseCoordinateTag(coordTag: any, ref?: string): number | null {
  if (coordTag === null || coordTag === undefined) return null;

  const rawValue =
    typeof coordTag === "number" || typeof coordTag === "string"
      ? coordTag
      : coordTag.value ?? coordTag.description;
  let coordinate: number | null = null;

  if (typeof rawValue === "number") {
    coordinate = rawValue;
  } else if (typeof rawValue === "string") {
    coordinate = parseCoordinateString(rawValue, ref);
  } else if (Array.isArray(rawValue)) {
    if (rawValue.length >= 3) {
      const degrees = parseRational(rawValue[0]);
      const minutes = parseRational(rawValue[1]);
      const seconds = parseRational(rawValue[2]);
      if (degrees !== null && minutes !== null && seconds !== null) {
        coordinate = Math.abs(degrees) + minutes / 60 + seconds / 3600;
      }
    } else if (rawValue.length === 1) {
      coordinate = parseRational(rawValue[0]);
    }
  } else {
    coordinate = parseRational(rawValue);
  }

  if (coordinate === null || !Number.isFinite(coordinate)) return null;
  return ref === "S" || ref === "W" ? -Math.abs(coordinate) : coordinate;
}

function parseRational(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length >= 2) {
    const numerator = Number(value[0]);
    const denominator = Number(value[1]);
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
      ? numerator / denominator
      : null;
  }
  if (value && typeof value === "object" && "numerator" in value && "denominator" in value) {
    const numerator = Number(value.numerator);
    const denominator = Number(value.denominator);
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
      ? numerator / denominator
      : null;
  }
  if (typeof value === "string") {
    const fraction = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
    if (fraction) {
      const numerator = Number(fraction[1]);
      const denominator = Number(fraction[2]);
      return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
        ? numerator / denominator
        : null;
    }
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCoordinateString(value: string, ref?: string): number | null {
  const normalized = value
    .trim()
    .replace(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/g, (_, numerator, denominator) => {
      const result = Number(numerator) / Number(denominator);
      return Number.isFinite(result) ? String(result) : "";
    })
    .replace(/[°'\"]/g, " ");
  const embeddedRef = normalized.match(/[NSEW]$/i)?.[0].toUpperCase();
  const effectiveRef = ref ?? embeddedRef;
  const numbers = normalized.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (numbers.length === 0 || numbers.some((number) => !Number.isFinite(number))) return null;

  const coordinate = numbers.length >= 3
    ? Math.abs(numbers[0]) + numbers[1] / 60 + numbers[2] / 3600
    : numbers.length >= 2
      ? Math.abs(numbers[0]) + numbers[1] / 60
      : numbers[0];
  return effectiveRef === "S" || effectiveRef === "W" ? -Math.abs(coordinate) : coordinate;
}

function findMetadataTag(tags: unknown, suffix: string): unknown {
  if (!tags || typeof tags !== "object" || Array.isArray(tags)) return undefined;
  const wanted = normalizeMetadataKey(suffix);
  for (const [key, value] of Object.entries(tags)) {
    if (normalizeMetadataKey(key).endsWith(wanted)) return value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = findMetadataTag(value, suffix);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function normalizeMetadataKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractRawXmpGps(raw: unknown): GpsCoordinates | null {
  if (typeof raw !== "string") return null;
  const latitude = parseCoordinateTag(extractXmpValue(raw, "GPSLatitude"));
  const longitude = parseCoordinateTag(extractXmpValue(raw, "GPSLongitude"));
  if (latitude === null || longitude === null) return null;

  const latitudeRef = readXmpReference(raw, "GPSLatitudeRef");
  const longitudeRef = readXmpReference(raw, "GPSLongitudeRef");
  const signedLatitude = latitudeRef ? parseCoordinateTag(String(latitude), latitudeRef) : latitude;
  const signedLongitude = longitudeRef ? parseCoordinateTag(String(longitude), longitudeRef) : longitude;
  return signedLatitude !== null && signedLongitude !== null
    ? toGpsCoordinates(signedLatitude, signedLongitude)
    : null;
}

const XMP_STANDARD_HEADER = "http://ns.adobe.com/xap/1.0/\u0000";
const XMP_EXTENDED_HEADER = "http://ns.adobe.com/xmp/extension/\u0000";

type XmpExtensionChunk = {
  guid: string;
  length: number;
  offset: number;
  data: string;
};

/** Reads XMP APP1 packets directly when an image parser does not expose them. */
function extractRawXmpGpsFromJpeg(buffer: ArrayBuffer | SharedArrayBuffer): GpsCoordinates | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const extendedChunks: XmpExtensionChunk[] = [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xff) continue;
    const segmentLength = readBigEndianU16(bytes, offset);
    if (segmentLength === null || segmentLength < 2 || offset + segmentLength > bytes.length) break;

    const dataStart = offset + 2;
    const dataEnd = offset + segmentLength;
    if (marker === 0xe1) {
      const data = bytes.slice(dataStart, dataEnd);
      const header = readAscii(data, 0, Math.min(data.length, XMP_EXTENDED_HEADER.length));
      if (header === XMP_STANDARD_HEADER) {
        const raw = decodeXmpBytes(data.slice(XMP_STANDARD_HEADER.length));
        const coordinates = extractRawXmpGps(raw);
        if (coordinates) return coordinates;
      } else if (header === XMP_EXTENDED_HEADER) {
        const chunk = parseXmpExtensionChunk(data);
        if (chunk) extendedChunks.push(chunk);
      }
    }
    offset += segmentLength;
  }

  const grouped = new Map<string, XmpExtensionChunk[]>();
  for (const chunk of extendedChunks) {
    const chunks = grouped.get(chunk.guid) ?? [];
    chunks.push(chunk);
    grouped.set(chunk.guid, chunks);
  }
  for (const chunks of grouped.values()) {
    chunks.sort((left, right) => left.offset - right.offset);
    const expectedLength = chunks[0]?.length;
    if (expectedLength === undefined || chunks[0].offset !== 0) continue;
    const raw = chunks.map((chunk) => chunk.data).join("");
    if (raw.length < expectedLength) continue;
    const coordinates = extractRawXmpGps(raw.slice(0, expectedLength));
    if (coordinates) return coordinates;
  }
  return null;
}

function parseXmpExtensionChunk(data: Uint8Array): XmpExtensionChunk | null {
  if (data.length < XMP_EXTENDED_HEADER.length + 40) return null;
  const guidStart = XMP_EXTENDED_HEADER.length;
  const guid = readAscii(data, guidStart, 32);
  const length = readBigEndianU32(data, guidStart + 32);
  const offset = readBigEndianU32(data, guidStart + 36);
  if (length === null || offset === null || offset > length) return null;
  return {
    guid,
    length,
    offset,
    data: decodeXmpBytes(data.slice(guidStart + 40)),
  };
}

function decodeXmpBytes(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function extractXmpValue(raw: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attribute = new RegExp(
    `(?:[A-Za-z_][\\w.-]*:)?${escapedName}\\s*=\\s*[\\\"']([^\\\"']+)`,
    "i",
  ).exec(raw)?.[1];
  if (attribute) return decodeXmlEntities(attribute);

  const element = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${escapedName}[^>]*>([^<]+)<`,
    "i",
  ).exec(raw)?.[1];
  return element ? decodeXmlEntities(element) : null;
}

function readXmpReference(raw: string, name: string): string | undefined {
  const value = extractXmpValue(raw, name);
  return value ? readReference({ value }) : undefined;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

type RawExifEntry = { type: number; count: number; valueOffset: number };

function extractRawExifGps(buffer: ArrayBuffer | SharedArrayBuffer): GpsCoordinates | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xff) continue;
    const segmentLength = readBigEndianU16(bytes, offset);
    if (segmentLength === null || segmentLength < 2 || offset + segmentLength > bytes.length) break;

    const dataStart = offset + 2;
    if (
      marker === 0xe1 &&
      dataStart + 6 <= bytes.length &&
      readAscii(bytes, dataStart, 6) === "Exif\u0000\u0000"
    ) {
      const coordinates = parseExifTiffGps(bytes, dataStart + 6);
      if (coordinates) return coordinates;
    }
    offset += segmentLength;
  }
  return null;
}

function parseExifTiffGps(bytes: Uint8Array, tiffStart: number): GpsCoordinates | null {
  if (tiffStart + 8 > bytes.length) return null;
  const littleEndian = readAscii(bytes, tiffStart, 2) === "II";
  if (!littleEndian && readAscii(bytes, tiffStart, 2) !== "MM") return null;
  const readU16 = (position: number) => readEndianU16(bytes, position, littleEndian);
  const readU32 = (position: number) => readEndianU32(bytes, position, littleEndian);
  if (readU16(tiffStart + 2) !== 42) return null;

  const firstIfdOffset = readU32(tiffStart + 4);
  if (firstIfdOffset === null) return null;

  // Most files put GPSInfoIFDPointer in IFD0, but some camera exporters put it
  // in the EXIF sub-IFD (or another linked IFD). Walk the standard IFD pointer
  // tags while tracking offsets so malformed metadata cannot create a loop.
  const pendingIfdOffsets = [firstIfdOffset];
  const visitedIfdOffsets = new Set<number>();
  while (pendingIfdOffsets.length > 0 && visitedIfdOffsets.size < 64) {
    const ifdOffset = pendingIfdOffsets.shift();
    if (ifdOffset === undefined || visitedIfdOffsets.has(ifdOffset)) continue;
    visitedIfdOffsets.add(ifdOffset);

    const ifd = readExifIfd(bytes, tiffStart, tiffStart + ifdOffset, littleEndian);
    const gpsPointer = ifd.get(0x8825);
    if (gpsPointer) {
      const gpsOffset = readExifUnsignedValue(bytes, gpsPointer, littleEndian);
      if (gpsOffset !== null) {
        const gpsIfd = readExifIfd(bytes, tiffStart, tiffStart + gpsOffset, littleEndian);
        const latitude = readExifRationals(bytes, gpsIfd.get(2), littleEndian);
        const longitude = readExifRationals(bytes, gpsIfd.get(4), littleEndian);
        if (latitude && longitude) {
          const latitudeRef = readExifAscii(bytes, gpsIfd.get(1));
          const longitudeRef = readExifAscii(bytes, gpsIfd.get(3));
          const latitudeValue = parseCoordinateTag(latitude, latitudeRef);
          const longitudeValue = parseCoordinateTag(longitude, longitudeRef);
          const coordinates = latitudeValue !== null && longitudeValue !== null
            ? toGpsCoordinates(latitudeValue, longitudeValue)
            : null;
          if (coordinates) return coordinates;
        }
      }
    }

    // ExifIFDPointer, SubIFDs, and InteroperabilityIFDPointer can lead to
    // another directory containing the GPS pointer.
    for (const pointerTag of [0x8769, 0x014a, 0xa005]) {
      const pointer = ifd.get(pointerTag);
      if (!pointer) continue;
      const offsets = readExifUnsignedValues(bytes, pointer, littleEndian);
      for (const offset of offsets) {
        if (offset > 0 && !visitedIfdOffsets.has(offset)) pendingIfdOffsets.push(offset);
      }
    }
  }
  return null;
}

function readExifIfd(
  bytes: Uint8Array,
  tiffStart: number,
  ifdOffset: number,
  littleEndian: boolean,
): Map<number, RawExifEntry> {
  const entries = new Map<number, RawExifEntry>();
  const count = readEndianU16(bytes, ifdOffset, littleEndian);
  if (count === null || count > 512) return entries;
  for (let index = 0; index < count; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    const tag = readEndianU16(bytes, entryOffset, littleEndian);
    const type = readEndianU16(bytes, entryOffset + 2, littleEndian);
    const itemCount = readEndianU32(bytes, entryOffset + 4, littleEndian);
    if (tag === null || type === null || itemCount === null) continue;
    const typeSize = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] ?? 0;
    const totalSize = typeSize * itemCount;
    const valueOffset = totalSize <= 4
      ? entryOffset + 8
      : (() => {
          const relativeOffset = readEndianU32(bytes, entryOffset + 8, littleEndian);
          return relativeOffset === null ? -1 : tiffStart + relativeOffset;
        })();
    if (valueOffset >= 0 && valueOffset + Math.min(totalSize, 4) <= bytes.length) {
      entries.set(tag, { type, count: itemCount, valueOffset });
    }
  }
  return entries;
}

function readExifUnsignedValue(
  bytes: Uint8Array,
  entry: RawExifEntry,
  littleEndian: boolean,
): number | null {
  return readExifUnsignedValues(bytes, entry, littleEndian)[0] ?? null;
}

function readExifUnsignedValues(
  bytes: Uint8Array,
  entry: RawExifEntry,
  littleEndian: boolean,
): number[] {
  if (entry.type !== 3 && entry.type !== 4) return [];
  const values: number[] = [];
  const itemSize = entry.type === 3 ? 2 : 4;
  for (let index = 0; index < entry.count; index += 1) {
    const position = entry.valueOffset + index * itemSize;
    const value = entry.type === 3
      ? readEndianU16(bytes, position, littleEndian)
      : readEndianU32(bytes, position, littleEndian);
    if (value === null) return [];
    values.push(value);
  }
  return values;
}

function readExifRationals(
  bytes: Uint8Array,
  entry: RawExifEntry | undefined,
  littleEndian: boolean,
): number[] | null {
  if (!entry || (entry.type !== 5 && entry.type !== 10) || entry.count < 3) return null;
  const values: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const position = entry.valueOffset + index * 8;
    const numerator = entry.type === 5
      ? readEndianU32(bytes, position, littleEndian)
      : readEndianI32(bytes, position, littleEndian);
    const denominator = entry.type === 5
      ? readEndianU32(bytes, position + 4, littleEndian)
      : readEndianI32(bytes, position + 4, littleEndian);
    if (numerator === null || denominator === null || denominator === 0) return null;
    values.push(numerator / denominator);
  }
  return values;
}

function readExifAscii(
  bytes: Uint8Array,
  entry: RawExifEntry | undefined,
): string | undefined {
  if (!entry || entry.type !== 2) return undefined;
  const end = Math.min(entry.valueOffset + entry.count, bytes.length);
  return readAscii(bytes, entry.valueOffset, end - entry.valueOffset).replace(/\0+$/, "").trim().toUpperCase();
}

function readBigEndianU16(bytes: Uint8Array, position: number): number | null {
  if (position < 0 || position + 2 > bytes.length) return null;
  return (bytes[position] << 8) | bytes[position + 1];
}

function readBigEndianU32(bytes: Uint8Array, position: number): number | null {
  if (position < 0 || position + 4 > bytes.length) return null;
  return (
    ((bytes[position] << 24) >>> 0) |
    (bytes[position + 1] << 16) |
    (bytes[position + 2] << 8) |
    bytes[position + 3]
  ) >>> 0;
}

function readEndianU16(bytes: Uint8Array, position: number, littleEndian: boolean): number | null {
  if (position < 0 || position + 2 > bytes.length) return null;
  return littleEndian
    ? bytes[position] | (bytes[position + 1] << 8)
    : (bytes[position] << 8) | bytes[position + 1];
}

function readEndianU32(bytes: Uint8Array, position: number, littleEndian: boolean): number | null {
  if (position < 0 || position + 4 > bytes.length) return null;
  return littleEndian
    ? (bytes[position] | (bytes[position + 1] << 8) | (bytes[position + 2] << 16) | (bytes[position + 3] << 24)) >>> 0
    : (((bytes[position] << 24) >>> 0) | (bytes[position + 1] << 16) | (bytes[position + 2] << 8) | bytes[position + 3]) >>> 0;
}

function readEndianI32(bytes: Uint8Array, position: number, littleEndian: boolean): number | null {
  const unsigned = readEndianU32(bytes, position, littleEndian);
  return unsigned === null ? null : unsigned | 0;
}

function readAscii(bytes: Uint8Array, position: number, length: number): string {
  return String.fromCharCode(...bytes.slice(position, position + length));
}
