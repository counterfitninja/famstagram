import assert from "node:assert/strict";
import test from "node:test";

import { extractFirstGpsCoordinates, extractGpsCoordinates } from "../lib/exif";
import { formatCoordinates, reverseGeocodeLocation } from "../lib/geocoding";
import { latitudeSchema, longitudeSchema, mapQuerySchema } from "../lib/validation";

test("coordinate validation schemas enforce WGS84 bounds", () => {
  assert.equal(latitudeSchema.safeParse(47.6062).success, true);
  assert.equal(latitudeSchema.safeParse(-90).success, true);
  assert.equal(latitudeSchema.safeParse(90).success, true);
  assert.equal(latitudeSchema.safeParse(91).success, false);
  assert.equal(latitudeSchema.safeParse(-90.1).success, false);

  assert.equal(longitudeSchema.safeParse(-122.3321).success, true);
  assert.equal(longitudeSchema.safeParse(-180).success, true);
  assert.equal(longitudeSchema.safeParse(180).success, true);
  assert.equal(longitudeSchema.safeParse(180.1).success, false);
  assert.equal(longitudeSchema.safeParse(-180.1).success, false);
});

test("map query schema applies defaults and bounds", () => {
  const parsedDefault = mapQuerySchema.parse({});
  assert.equal(parsedDefault.limit, 50);

  const parsedCustom = mapQuerySchema.parse({ limit: "100", feedId: "feed_123" });
  assert.equal(parsedCustom.limit, 100);
  assert.equal(parsedCustom.feedId, "feed_123");

  assert.equal(mapQuerySchema.safeParse({ limit: 0 }).success, false);
  assert.equal(mapQuerySchema.safeParse({ limit: 600 }).success, false);
});

test("formatCoordinates formats latitude and longitude into friendly representation", () => {
  assert.equal(formatCoordinates(47.6062, -122.3321), "47.6062° N, 122.3321° W");
  assert.equal(formatCoordinates(-33.8688, 151.2093), "33.8688° S, 151.2093° E");
});

test("extractGpsCoordinates gracefully handles empty or non-image buffers", async () => {
  const empty = Buffer.alloc(0);
  const result = await extractGpsCoordinates(empty);
  assert.equal(result, null);

  const randomData = Buffer.from("Not an image file at all");
  const resultRandom = await extractGpsCoordinates(randomData);
  assert.equal(resultRandom, null);

  // Partial or corrupted JPEG header
  const corruptJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00]);
  const resultCorrupt = await extractGpsCoordinates(corruptJpeg);
  assert.equal(resultCorrupt, null);
});

test("extracts GPS from a photo whose mobile MIME type is video/mp4", async () => {
  const bytes = new Uint8Array(140);
  let offset = 0;
  const write = (...values: number[]) => {
    bytes.set(values, offset);
    offset += values.length;
  };
  const writeU16 = (value: number) => write(value & 0xff, value >> 8);
  const writeU32 = (value: number) =>
    write(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);

  write(0xff, 0xd8, 0xff, 0xe1);
  const length = offset;
  write(0, 0, ...Array.from(Buffer.from("Exif\0\0")));
  write(0x49, 0x49, 0x2a, 0, 8, 0, 0, 0);
  writeU16(1);
  writeU16(0x8825);
  writeU16(4);
  writeU32(1);
  writeU32(26);
  writeU32(0);
  writeU16(4);
  writeU16(1);
  writeU16(2);
  writeU32(2);
  write(0x4e, 0, 0, 0);
  writeU16(2);
  writeU16(5);
  writeU32(3);
  writeU32(80);
  writeU16(3);
  writeU16(2);
  writeU32(2);
  write(0x57, 0, 0, 0);
  writeU16(4);
  writeU16(5);
  writeU32(3);
  writeU32(104);
  writeU32(0);
  while (offset < 92) write(0);
  writeU32(47);
  writeU32(1);
  writeU32(36);
  writeU32(1);
  writeU32(222);
  writeU32(10);
  writeU32(122);
  writeU32(1);
  writeU32(20);
  writeU32(1);
  writeU32(0);
  writeU32(1);
  bytes[length] = (offset - length) >> 8;
  bytes[length + 1] = (offset - length) & 0xff;

  const file = new File([bytes], "photo", { type: "video/mp4" });
  const coordinates = await extractFirstGpsCoordinates([file]);

  assert.deepEqual(coordinates, { latitude: 47.606167, longitude: -122.333333 });
});

test("extracts GPS from ISO-BMFF location metadata shared by Google Photos", async () => {
  const makeBox = (type: Uint8Array, payload: Uint8Array) => {
    const box = Buffer.alloc(8 + payload.length);
    box.writeUInt32BE(box.length, 0);
    box.set(type, 4);
    box.set(payload, 8);
    return box;
  };
  const ftyp = makeBox(Buffer.from("ftyp", "ascii"), Buffer.from("isom\0\0\0\0", "ascii"));
  const location = Buffer.from("+47.6062-122.3321+000.000/\0", "ascii");
  const xyz = makeBox(Uint8Array.from([0xa9, 0x78, 0x79, 0x7a]), location);
  const udta = makeBox(Buffer.from("udta", "ascii"), xyz);
  const mp4 = Buffer.concat([ftyp, makeBox(Buffer.from("moov", "ascii"), udta)]);

  const coordinates = await extractFirstGpsCoordinates([
    new File([mp4], "shared-video", { type: "video/mp4" }),
  ]);

  assert.deepEqual(coordinates, { latitude: 47.6062, longitude: -122.3321 });
});

test("does not treat signed numbers in JPEG bytes as ISO-BMFF GPS", async () => {
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    Buffer.from("+1.0000+2.0000+000.000/", "ascii"),
    Buffer.from([0xff, 0xd9]),
  ]);

  const coordinates = await extractFirstGpsCoordinates([
    new File([jpeg], "photo.jpg", { type: "image/jpeg" }),
  ]);

  assert.equal(coordinates, null);
});

test("extracts GPS when EXIF uses TIFF IFD pointer types", async () => {
  const tiff = Buffer.alloc(280);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);

  // IFD0 -> GPS IFD, using TIFF type 13 (IFD) for the pointer.
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10);
  tiff.writeUInt16LE(13, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(100, 18);

  const gpsOffset = 100;
  tiff.writeUInt16LE(4, gpsOffset);
  tiff.writeUInt16LE(1, gpsOffset + 2);
  tiff.writeUInt16LE(2, gpsOffset + 4);
  tiff.writeUInt32LE(2, gpsOffset + 6);
  tiff.write("N\0", gpsOffset + 10, "ascii");
  tiff.writeUInt16LE(2, gpsOffset + 14);
  tiff.writeUInt16LE(5, gpsOffset + 16);
  tiff.writeUInt32LE(3, gpsOffset + 18);
  tiff.writeUInt32LE(220, gpsOffset + 22);
  tiff.writeUInt16LE(3, gpsOffset + 26);
  tiff.writeUInt16LE(2, gpsOffset + 28);
  tiff.writeUInt32LE(2, gpsOffset + 30);
  tiff.write("W\0", gpsOffset + 34, "ascii");
  tiff.writeUInt16LE(4, gpsOffset + 38);
  tiff.writeUInt16LE(5, gpsOffset + 40);
  tiff.writeUInt32LE(3, gpsOffset + 42);
  tiff.writeUInt32LE(244, gpsOffset + 46);

  const writeRational = (offset: number, value: number) => {
    tiff.writeUInt32LE(value, offset);
    tiff.writeUInt32LE(1, offset + 4);
  };
  writeRational(220, 47);
  writeRational(228, 36);
  writeRational(236, 22);
  writeRational(244, 122);
  writeRational(252, 20);
  writeRational(260, 0);

  const exif = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const segmentLength = Buffer.alloc(2);
  segmentLength.writeUInt16BE(exif.length + 2);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    segmentLength,
    exif,
    Buffer.from([0xff, 0xd9]),
  ]);

  const coordinates = await extractFirstGpsCoordinates([
    new File([jpeg], "photo.jpg", { type: "image/jpeg" }),
  ]);
  assert.deepEqual(coordinates, { latitude: 47.606111, longitude: -122.333333 });
});

test("extracts GPS when the GPS pointer is in an EXIF sub-IFD", async () => {
  const tiff = Buffer.alloc(280);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);

  // IFD0 -> EXIF sub-IFD -> GPS IFD.
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(100, 18);

  tiff.writeUInt16LE(1, 100);
  tiff.writeUInt16LE(0x8825, 102);
  tiff.writeUInt16LE(4, 104);
  tiff.writeUInt32LE(1, 106);
  tiff.writeUInt32LE(120, 110);

  const gpsOffset = 120;
  tiff.writeUInt16LE(4, gpsOffset);
  tiff.writeUInt16LE(1, gpsOffset + 2);
  tiff.writeUInt16LE(2, gpsOffset + 4);
  tiff.writeUInt32LE(2, gpsOffset + 6);
  tiff.write("N\0", gpsOffset + 10, "ascii");
  tiff.writeUInt16LE(2, gpsOffset + 14);
  tiff.writeUInt16LE(5, gpsOffset + 16);
  tiff.writeUInt32LE(3, gpsOffset + 18);
  tiff.writeUInt32LE(220, gpsOffset + 22);
  tiff.writeUInt16LE(3, gpsOffset + 26);
  tiff.writeUInt16LE(2, gpsOffset + 28);
  tiff.writeUInt32LE(2, gpsOffset + 30);
  tiff.write("W\0", gpsOffset + 34, "ascii");
  tiff.writeUInt16LE(4, gpsOffset + 38);
  tiff.writeUInt16LE(5, gpsOffset + 40);
  tiff.writeUInt32LE(3, gpsOffset + 42);
  tiff.writeUInt32LE(244, gpsOffset + 46);

  const writeRational = (offset: number, value: number) => {
    tiff.writeUInt32LE(value, offset);
    tiff.writeUInt32LE(1, offset + 4);
  };
  writeRational(220, 47);
  writeRational(228, 36);
  writeRational(236, 22);
  writeRational(244, 122);
  writeRational(252, 20);
  writeRational(260, 0);

  const exif = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const segmentLength = Buffer.alloc(2);
  segmentLength.writeUInt16BE(exif.length + 2);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    segmentLength,
    exif,
    Buffer.from([0xff, 0xd9]),
  ]);

  const coordinates = await extractFirstGpsCoordinates([
    new File([jpeg], "photo.jpg", { type: "image/jpeg" }),
  ]);
  assert.deepEqual(coordinates, { latitude: 47.606111, longitude: -122.333333 });
});

test("extracts GPS from an EXIF IFD reached through the next-IFD link", async () => {
  const tiff = Buffer.alloc(240);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);

  // IFD0 has no tags and links to IFD1, where this camera stores GPSInfo.
  tiff.writeUInt16LE(0, 8);
  tiff.writeUInt32LE(40, 10);
  tiff.writeUInt16LE(1, 40);
  tiff.writeUInt16LE(0x8825, 42);
  tiff.writeUInt16LE(4, 44);
  tiff.writeUInt32LE(1, 46);
  tiff.writeUInt32LE(80, 50);
  tiff.writeUInt32LE(0, 54);

  const gpsOffset = 80;
  tiff.writeUInt16LE(4, gpsOffset);
  tiff.writeUInt16LE(1, gpsOffset + 2);
  tiff.writeUInt16LE(2, gpsOffset + 4);
  tiff.writeUInt32LE(2, gpsOffset + 6);
  tiff.write("N\0", gpsOffset + 10, "ascii");
  tiff.writeUInt16LE(2, gpsOffset + 14);
  tiff.writeUInt16LE(5, gpsOffset + 16);
  tiff.writeUInt32LE(3, gpsOffset + 18);
  tiff.writeUInt32LE(160, gpsOffset + 22);
  tiff.writeUInt16LE(3, gpsOffset + 26);
  tiff.writeUInt16LE(2, gpsOffset + 28);
  tiff.writeUInt32LE(2, gpsOffset + 30);
  tiff.write("W\0", gpsOffset + 34, "ascii");
  tiff.writeUInt16LE(4, gpsOffset + 38);
  tiff.writeUInt16LE(5, gpsOffset + 40);
  tiff.writeUInt32LE(3, gpsOffset + 42);
  tiff.writeUInt32LE(184, gpsOffset + 46);
  tiff.writeUInt32LE(0, gpsOffset + 50);

  const writeRational = (offset: number, value: number) => {
    tiff.writeUInt32LE(value, offset);
    tiff.writeUInt32LE(1, offset + 4);
  };
  writeRational(160, 47);
  writeRational(168, 36);
  writeRational(176, 22);
  writeRational(184, 122);
  writeRational(192, 20);
  writeRational(200, 0);

  const exif = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const segmentLength = Buffer.alloc(2);
  segmentLength.writeUInt16BE(exif.length + 2);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    segmentLength,
    exif,
    Buffer.from([0xff, 0xd9]),
  ]);

  const coordinates = await extractFirstGpsCoordinates([
    new File([jpeg], "photo.jpg", { type: "image/jpeg" }),
  ]);
  assert.deepEqual(coordinates, { latitude: 47.606111, longitude: -122.333333 });
});

test("recovers GPS when a mobile JPEG has a malformed EXIF segment length", async () => {
  const tiff = Buffer.alloc(220);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(40, 18);
  tiff.writeUInt32LE(0, 22);
  tiff.writeUInt16LE(4, 40);
  tiff.writeUInt16LE(1, 42);
  tiff.writeUInt16LE(2, 44);
  tiff.writeUInt32LE(2, 46);
  tiff.write("N\0", 50, "ascii");
  tiff.writeUInt16LE(2, 54);
  tiff.writeUInt16LE(5, 56);
  tiff.writeUInt32LE(3, 58);
  tiff.writeUInt32LE(100, 62);
  tiff.writeUInt16LE(3, 66);
  tiff.writeUInt16LE(2, 68);
  tiff.writeUInt32LE(2, 70);
  tiff.write("W\0", 74, "ascii");
  tiff.writeUInt16LE(4, 78);
  tiff.writeUInt16LE(5, 80);
  tiff.writeUInt32LE(3, 82);
  tiff.writeUInt32LE(124, 86);
  tiff.writeUInt32LE(47, 100);
  tiff.writeUInt32LE(1, 104);
  tiff.writeUInt32LE(36, 108);
  tiff.writeUInt32LE(1, 112);
  tiff.writeUInt32LE(22, 116);
  tiff.writeUInt32LE(1, 120);
  tiff.writeUInt32LE(122, 124);
  tiff.writeUInt32LE(1, 128);
  tiff.writeUInt32LE(20, 132);
  tiff.writeUInt32LE(1, 136);
  tiff.writeUInt32LE(0, 140);
  tiff.writeUInt32LE(1, 144);

  const exif = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]),
    exif,
    Buffer.from([0xff, 0xd9]),
  ]);
  const coordinates = await extractFirstGpsCoordinates([
    new File([jpeg], "photo.jpg", { type: "image/jpeg" }),
  ]);
  assert.deepEqual(coordinates, { latitude: 47.606111, longitude: -122.333333 });
});

test("extracts GPS from namespaced XMP metadata in a JPEG", async () => {
  const xmp = Buffer.from(
    `http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:geo="https://example.com/geo/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description geo:GPSLatitude="47,36.22N" geo:GPSLongitude="122,20.0W" /></rdf:RDF></x:xmpmeta>`,
  );
  const length = Buffer.alloc(2);
  length.writeUInt16BE(xmp.length + 2);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), length, xmp, Buffer.from([0xff, 0xd9])]);
  const file = new File([jpeg], "photo.jpg", { type: "image/jpeg" });

  const coordinates = await extractFirstGpsCoordinates([file]);
  assert.deepEqual(coordinates, { latitude: 47.603667, longitude: -122.333333 });
});

test("parses rational XMP coordinates and human-readable direction references", async () => {
  const xmp = Buffer.from(
    `http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:exif="http://ns.adobe.com/exif/1.0/"><rdf:RDF><rdf:Description exif:GPSLatitude="47/1,36/1,22/1" exif:GPSLatitudeRef="North latitude" exif:GPSLongitude="122/1,20/1,0/1" exif:GPSLongitudeRef="West longitude" /></rdf:RDF></x:xmpmeta>`,
  );
  const length = Buffer.alloc(2);
  length.writeUInt16BE(xmp.length + 2);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), length, xmp, Buffer.from([0xff, 0xd9])]);

  const coordinates = await extractFirstGpsCoordinates([
    new File([jpeg], "photo.jpg", { type: "image/jpeg" }),
  ]);

  assert.deepEqual(coordinates, { latitude: 47.606111, longitude: -122.333333 });
});

test("extracts GPS from extended XMP packets when the primary XMP packet omits GPS", async () => {
  const standardHeader = Buffer.from("http://ns.adobe.com/xap/1.0/\0");
  const extensionHeader = Buffer.from("http://ns.adobe.com/xmp/extension/\0");
  const guid = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
  const extendedXmp = Buffer.from(
    `<x:xmpmeta xmlns:x="http://ns.adobe.com/xap/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:exif="http://ns.adobe.com/exif/1.0/"><rdf:RDF><rdf:Description exif:GPSLatitude="51,14.123N" exif:GPSLongitude="2,19.262W" /></rdf:RDF></x:xmpmeta>`,
  );
  const standardXmp = Buffer.concat([
    standardHeader,
    Buffer.from(`<x:xmpmeta xmlns:x="http://ns.adobe.com/xap/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmpNote="http://ns.adobe.com/xmp/note/"><rdf:RDF><rdf:Description xmpNote:HasExtendedXMP="${guid}" /></rdf:RDF></x:xmpmeta>`),
  ]);
  const makeApp1 = (data: Buffer) => {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(data.length + 2);
    return Buffer.concat([Buffer.from([0xff, 0xe1]), length, data]);
  };
  const makeExtension = (chunk: Buffer, offset: number) => {
    const metadata = Buffer.alloc(8);
    metadata.writeUInt32BE(extendedXmp.length, 0);
    metadata.writeUInt32BE(offset, 4);
    return Buffer.concat([extensionHeader, Buffer.from(guid), metadata, chunk]);
  };
  const midpoint = Math.floor(extendedXmp.length / 2);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    makeApp1(standardXmp),
    makeApp1(makeExtension(extendedXmp.subarray(0, midpoint), 0)),
    makeApp1(makeExtension(extendedXmp.subarray(midpoint), midpoint)),
    Buffer.from([0xff, 0xd9]),
  ]);

  const coordinates = await extractFirstGpsCoordinates([
    new File([jpeg], "photo.jpg", { type: "image/jpeg" }),
  ]);

  assert.deepEqual(coordinates, { latitude: 51.235383, longitude: -2.321033 });
});

test("reverseGeocodeLocation returns coordinate string as fallback when network is unreachable or times out", async () => {
  // Uses unreachable port/timeout to verify fallback mechanism
  const location = await reverseGeocodeLocation(47.6062, -122.3321, 10);
  assert.match(location, /47\.6062° N, 122\.3321° W/);
});
