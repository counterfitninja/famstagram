import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const template = readFileSync(new URL("../src/map-template.html", import.meta.url), "utf8");

test("map assets are bundled and tile requests retain attribution without third-party scripts", () => {
  assert.doesNotMatch(template, /<script[^>]+src=/);
  assert.match(template, /https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.match(template, /openstreetmap\.org\/copyright/);
  const generated = readFileSync(new URL("../src/generated/leaflet.ts", import.meta.url), "utf8");
  assert.match(generated, /Leaflet 1\.9\.4/);
  assert.match(generated, /BSD 2-Clause License/);
  assert.doesNotMatch(generated, /\/\* LEAFLET_(CSS|JS) \*\//);
});

test("map pins use literal text, preserve zero coordinates, and route by post ID", () => {
  const messages = [];
  const popups = [];
  const coordinates = [];
  const handlers = {};
  const map = { setView() { return this; }, fitBounds() {}, invalidateSize() {} };
  const context = {
    window: { ReactNativeWebView: { postMessage: (value) => messages.push(JSON.parse(value)) } },
    document: { createElement: (tag) => ({ tag, children: [], appendChild(child) { this.children.push(child); } }) },
    L: {
      map: () => map,
      tileLayer: () => ({ on(name, callback) { handlers[name] = callback; return this; }, addTo() {} }),
      layerGroup: () => ({ addTo() { return this; }, clearLayers() {} }),
      divIcon: (options) => options,
      marker: (location) => { coordinates.push(location); return { bindPopup(popup) { popups.push(popup); return this; }, addTo() {} }; },
    },
  };
  const script = template.match(/<script>([\s\S]*?)<\/script>/g).at(-1).replace(/^<script>|<\/script>$/g, "");
  vm.runInNewContext(script, context);
  context.window.updatePoints([{ id: "post-a", latitude: 0, longitude: 0, title: "<img onerror=alert(1)>", description: "</script><script>attack()</script>" }]);
  assert.equal(coordinates[0][0], 0);
  assert.equal(coordinates[0][1], 0);
  assert.equal(popups[0].children[0].textContent, "<img onerror=alert(1)>");
  assert.equal(popups[0].children[1].textContent, "</script><script>attack()</script>");
  popups[0].children[2].onclick();
  assert.deepEqual(messages, [{ type: "ready" }, { type: "post", id: "post-a" }]);
  handlers.tileerror();
  assert.deepEqual(messages.at(-1), { type: "tileError" });
});
