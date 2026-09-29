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

test("reverseGeocodeLocation returns coordinate string as fallback when network is unreachable or times out", async () => {
  // Uses unreachable port/timeout to verify fallback mechanism
  const location = await reverseGeocodeLocation(47.6062, -122.3321, 10);
  assert.match(location, /47\.6062° N, 122\.3321° W/);
});
