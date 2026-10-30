import React, { useEffect, useRef, useState } from "react";
import { Linking, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import mapHtml from "./generated/leaflet";
import { serverUrl } from "./api";
import { s } from "./ui";

export type MapPoint = { id?: string; latitude: number; longitude: number; title: string; description?: string };

export function PhotoMap({ points, onPost }: { points: MapPoint[]; onPost?: (id: string) => void }) {
  const ref = useRef<WebView<unknown>>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const valid = points.filter((p) => Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 &&
      Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180);
    // Double-encode as a JS string, never interpolate captions into HTML.
    ref.current?.injectJavaScript(`window.updatePoints(JSON.parse(${JSON.stringify(JSON.stringify(valid))}));true;`);
  }, [points, ready]);
  return <View style={{ flex: 1 }}>
    {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <WebView<unknown> ref={ref} style={{ flex: 1 }} source={{ html: mapHtml, baseUrl: `${serverUrl}/` }}
      applicationNameForUserAgent="Famstagram/0.1" originWhitelist={["*"]}
      javaScriptEnabled domStorageEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
      mixedContentMode="never" allowFileAccess={false}
      onShouldStartLoadWithRequest={(request) => {
        if (request.url === "about:blank" || request.url === `${serverUrl}/`) return true;
        if (request.url === "https://www.openstreetmap.org/copyright") {
          void Linking.openURL(request.url).catch(() => setError("Could not open map attribution."));
        }
        return false;
      }}
      onError={() => setError("The map could not load. Check your connection and reopen this screen.")}
      onMessage={({ nativeEvent }) => {
        let value: unknown;
        try { value = JSON.parse(nativeEvent.data); } catch { setError("The map returned an invalid response."); return; }
        if (!value || typeof value !== "object" || !("type" in value)) return;
        if (value.type === "ready") { setError(null); setReady(true); }
        if (value.type === "tileError") setError("Some map tiles could not load. Check your connection.");
        if (value.type === "post" && "id" in value && typeof value.id === "string" && points.some((p) => p.id === value.id)) onPost?.(value.id);
      }} />
  </View>;
}
