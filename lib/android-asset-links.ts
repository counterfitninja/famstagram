export const ANDROID_PACKAGE_ID = "uk.co.famstagram.app";

export function getAndroidAssetLinks(fingerprints: string | undefined) {
  if (!fingerprints?.trim()) return [];

  const values = [...new Set(fingerprints.split(",").map((value) => value.trim().toUpperCase()))];
  if (values.some((value) => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value))) {
    throw new Error("Invalid Android SHA-256 certificate fingerprint configuration");
  }

  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE_ID,
        sha256_cert_fingerprints: values,
      },
    },
  ];
}
