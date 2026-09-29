import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSharedMediaFile, validateMediaFiles } from "../lib/validation";

test("normalizes a Google Photos JPEG with a generic MIME type", async () => {
  const sharedFile = new File(
    [Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])],
    "shared-image",
    { type: "application/octet-stream" },
  );

  const normalized = await normalizeSharedMediaFile(sharedFile);

  assert.equal(normalized.type, "image/jpeg");
  assert.deepEqual(validateMediaFiles([normalized]), {});
});

test("normalizes supported shared media by filename extension", async () => {
  const sharedFile = new File(["image"], "photo.JPG", { type: "" });

  const normalized = await normalizeSharedMediaFile(sharedFile);

  assert.equal(normalized.type, "image/jpeg");
  assert.deepEqual(validateMediaFiles([normalized]), {});
});

test("recognizes a HEIC file with a generic MIME type as an image", async () => {
  const heicHeader = new Uint8Array(12);
  heicHeader.set([0, 0, 0, 0], 0);
  heicHeader.set([0x66, 0x74, 0x79, 0x70], 4);
  heicHeader.set([0x68, 0x65, 0x69, 0x63], 8);
  const sharedFile = new File([heicHeader], "photo", { type: "application/octet-stream" });

  const normalized = await normalizeSharedMediaFile(sharedFile);

  assert.equal(normalized.type, "image/heic");
  assert.deepEqual(validateMediaFiles([normalized]), {});
});

test("corrects a mobile picker that labels a HEIC photo as video/mp4", async () => {
  const sharedFile = new File(["image"], "photo.HEIC", { type: "video/mp4" });

  const normalized = await normalizeSharedMediaFile(sharedFile);

  assert.equal(normalized.type, "image/heic");
  assert.deepEqual(validateMediaFiles([normalized]), {});
});

test("uses the file signature when a mobile picker mislabels a JPEG as video/mp4", async () => {
  const sharedFile = new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])], "photo", {
    type: "video/mp4",
  });

  const normalized = await normalizeSharedMediaFile(sharedFile);

  assert.equal(normalized.type, "image/jpeg");
  assert.deepEqual(validateMediaFiles([normalized]), {});
});

test("recognizes an extensionless HEIC photo mislabeled as video/mp4", async () => {
  const heicHeader = new Uint8Array(12);
  heicHeader.set([0, 0, 0, 0], 0);
  heicHeader.set([0x66, 0x74, 0x79, 0x70], 4);
  heicHeader.set([0x68, 0x65, 0x69, 0x78], 8);
  const sharedFile = new File([heicHeader], "photo", { type: "video/mp4" });

  const normalized = await normalizeSharedMediaFile(sharedFile);

  assert.equal(normalized.type, "image/heic");
  assert.deepEqual(validateMediaFiles([normalized]), {});
});

test("does not disguise unsupported shared files", async () => {
  const sharedFile = new File(["document"], "notes.txt", { type: "application/octet-stream" });

  const normalized = await normalizeSharedMediaFile(sharedFile);

  assert.equal(normalized.type, "application/octet-stream");
  assert.match(validateMediaFiles([normalized]).error ?? "", /Unsupported file type/);
});