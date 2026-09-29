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
    // Some camera apps omit the reference tags, so also parse the raw values here.
    const exifTags = tags.exif ?? tags;
    const latitude = parseCoordinateTag(exifTags.GPSLatitude, readReference(exifTags.GPSLatitudeRef));
    const longitude = parseCoordinateTag(exifTags.GPSLongitude, readReference(exifTags.GPSLongitudeRef));
    if (latitude !== null && longitude !== null) {
      return { coordinates: toGpsCoordinates(latitude, longitude), source: "exif" };
    }

    // A number of mobile/photo apps store GPS in XMP rather than the EXIF GPS IFD.
    const xmpTags = tags.xmp ?? {};
    const xmpLatitudeTag = findXmpTag(xmpTags, "gpslatitude");
    const xmpLongitudeTag = findXmpTag(xmpTags, "gpslongitude");
    const xmpLatitudeRefTag = findXmpTag(xmpTags, "gpslatituderef");
    const xmpLongitudeRefTag = findXmpTag(xmpTags, "gpslongituderef");
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
    const rawXmpCoordinates = extractRawXmpGps(xmpTags?._raw);
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
  if (Array.isArray(value)) return value.join("").trim().toUpperCase();
  if (typeof value === "string") return value.trim().toUpperCase();
  return undefined;
}

function parseCoordinateTag(coordTag: any, ref?: string): number | null {
  if (coordTag === null || coordTag === undefined) return null;

  const rawValue = typeof coordTag === "number" ? coordTag : coordTag.value ?? coordTag.description;
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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCoordinateString(value: string, ref?: string): number | null {
  const normalized = value.trim().replace(/[°'\"]/g, " ");
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

function findXmpTag(tags: Record<string, unknown>, suffix: string): unknown {
  const wanted = suffix.toLowerCase();
  for (const [key, value] of Object.entries(tags)) {
    if (key.toLowerCase().endsWith(wanted)) return value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = findXmpTag(value as Record<string, unknown>, wanted);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
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
  return value?.trim().toUpperCase();
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
  const ifd = readExifIfd(bytes, tiffStart, tiffStart + firstIfdOffset, littleEndian);
  const gpsPointer = ifd.get(0x8825);
  if (!gpsPointer) return null;
  const gpsOffset = readExifUnsignedValue(bytes, gpsPointer, littleEndian);
  if (gpsOffset === null) return null;

  const gpsIfd = readExifIfd(bytes, tiffStart, tiffStart + gpsOffset, littleEndian);
  const latitude = readExifRationals(bytes, gpsIfd.get(2), littleEndian);
  const longitude = readExifRationals(bytes, gpsIfd.get(4), littleEndian);
  if (!latitude || !longitude) return null;

  const latitudeRef = readExifAscii(bytes, gpsIfd.get(1));
  const longitudeRef = readExifAscii(bytes, gpsIfd.get(3));
  const latitudeValue = parseCoordinateTag(latitude, latitudeRef);
  const longitudeValue = parseCoordinateTag(longitude, longitudeRef);
  return latitudeValue !== null && longitudeValue !== null
    ? toGpsCoordinates(latitudeValue, longitudeValue)
    : null;
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
  if (entry.type !== 3 && entry.type !== 4) return null;
  return entry.type === 3
    ? readEndianU16(bytes, entry.valueOffset, littleEndian)
    : readEndianU32(bytes, entry.valueOffset, littleEndian);
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
