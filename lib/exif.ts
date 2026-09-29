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
  source?: "expanded" | "exif" | "xmp";
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
    const xmpLatitude = parseCoordinateTag(
      xmpTags["exif:GPSLatitude"] ?? xmpTags.GPSLatitude,
      readReference(xmpTags["exif:GPSLatitudeRef"] ?? xmpTags.GPSLatitudeRef),
    );
    const xmpLongitude = parseCoordinateTag(
      xmpTags["exif:GPSLongitude"] ?? xmpTags.GPSLongitude,
      readReference(xmpTags["exif:GPSLongitudeRef"] ?? xmpTags.GPSLongitudeRef),
    );
    if (xmpLatitude !== null && xmpLongitude !== null) {
      return { coordinates: toGpsCoordinates(xmpLatitude, xmpLongitude), source: "xmp" };
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
