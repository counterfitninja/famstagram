"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { updatePostLocation } from "@/app/actions/posts";
import { btnPrimary, inputCls } from "@/lib/ui";

const LocationPicker = dynamic(() => import("@/components/LocationPicker"), { ssr: false });

type LocationSearchResult = {
  displayName: string;
  latitude: number;
  longitude: number;
};

export default function EditLocationButton({
  postId,
  latitude,
  longitude,
  locationName,
}: {
  postId: string;
  latitude: number | null;
  longitude: number | null;
  locationName?: string | null;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"search" | "map">("search");
  const [selectedLatitude, setSelectedLatitude] = useState<number | null>(latitude);
  const [selectedLongitude, setSelectedLongitude] = useState<number | null>(longitude);
  const [selectedLocationName, setSelectedLocationName] = useState<string | null>(locationName ?? null);
  const [searchQuery, setSearchQuery] = useState(locationName ?? "");
  const [searchResults, setSearchResults] = useState<LocationSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpen() {
    setSelectedLatitude(latitude);
    setSelectedLongitude(longitude);
    setSelectedLocationName(locationName ?? null);
    setSearchQuery(locationName ?? "");
    setSearchResults([]);
    setMode("search");
    setError(null);
    setIsOpen(true);
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 2) {
      setError("Enter at least 2 characters to search for a place.");
      setSearchResults([]);
      return;
    }

    setError(null);
    setIsSearching(true);
    try {
      const response = await fetch(`/api/geocoding/search?q=${encodeURIComponent(query)}`);
      const payload = (await response.json()) as {
        results?: LocationSearchResult[];
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "Location search is temporarily unavailable.");
        setSearchResults([]);
        return;
      }
      setSearchResults(payload.results ?? []);
      if ((payload.results ?? []).length === 0) {
        setError("No places found. Try a nearby town, landmark, or address.");
      }
    } catch {
      setError("Location search is temporarily unavailable.");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }

  function selectResult(result: LocationSearchResult) {
    setSelectedLatitude(result.latitude);
    setSelectedLongitude(result.longitude);
    setSelectedLocationName(result.displayName);
    setSearchQuery(result.displayName);
    setSearchResults([]);
    setError(null);
  }

  function handleMapPick(nextLatitude: number, nextLongitude: number) {
    setSelectedLatitude(nextLatitude);
    setSelectedLongitude(nextLongitude);
    setSelectedLocationName(null);
    setSearchQuery("");
    setError(null);
  }

  function clearLocation() {
    setSelectedLatitude(null);
    setSelectedLongitude(null);
    setSelectedLocationName(null);
    setSearchQuery("");
    setSearchResults([]);
    setError(null);
  }

  function handleSave() {
    setError(null);
    if ((selectedLatitude === null) !== (selectedLongitude === null)) {
      setError("Choose a location, or clear the current location.");
      return;
    }

    startTransition(async () => {
      const result = await updatePostLocation(
        postId,
        selectedLatitude,
        selectedLongitude,
        selectedLocationName,
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      setIsOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200"
        title="Admin: edit photo location"
      >
        <span>✏️</span>
        <span className="hidden sm:inline">Edit location</span>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isPending) setIsOpen(false);
          }}
        >
          <div
            className="flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-location-title"
          >
            <div className="border-b border-neutral-100 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="edit-location-title" className="text-base font-semibold text-neutral-900">
                    Choose photo location
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">
                    Search for a place or tap the map to drop the pin. Your selection will appear on the photo.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={isPending}
                  className="rounded-lg p-1 text-lg leading-none text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                  aria-label="Close location editor"
                >
                  ×
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 rounded-lg bg-neutral-100 p-1" role="tablist" aria-label="Location selection method">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "search"}
                  onClick={() => setMode("search")}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    mode === "search" ? "bg-white text-sky-700 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
                  }`}
                >
                  Search a place
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "map"}
                  onClick={() => setMode("map")}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    mode === "map" ? "bg-white text-sky-700 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
                  }`}
                >
                  Pick on map
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {mode === "search" ? (
                <div>
                  <form onSubmit={handleSearch} className="flex gap-2">
                    <label htmlFor="location-search" className="sr-only">
                      Search for a place
                    </label>
                    <input
                      id="location-search"
                      type="search"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Try a city, landmark, or address"
                      className={inputCls}
                      autoComplete="off"
                    />
                    <button
                      type="submit"
                      disabled={isSearching || isPending}
                      className="shrink-0 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-wait disabled:opacity-50"
                    >
                      {isSearching ? "Searching…" : "Search"}
                    </button>
                  </form>

                  {searchResults.length > 0 && (
                    <div className="mt-3 overflow-hidden rounded-xl border border-neutral-200" role="listbox" aria-label="Location search results">
                      {searchResults.map((result) => (
                        <button
                          key={`${result.latitude}:${result.longitude}:${result.displayName}`}
                          type="button"
                          role="option"
                          onClick={() => selectResult(result)}
                          className="flex w-full items-start gap-3 border-b border-neutral-100 px-3 py-3 text-left transition-colors last:border-0 hover:bg-sky-50"
                        >
                          <span className="mt-0.5 text-base" aria-hidden="true">📍</span>
                          <span className="min-w-0 text-sm leading-5 text-neutral-700">{result.displayName}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {selectedLatitude !== null && selectedLongitude !== null && (
                    <div className="mt-4 rounded-xl bg-sky-50 px-3.5 py-3 text-sm text-sky-900">
                      <p className="font-medium">Selected location</p>
                      <p className="mt-0.5 truncate text-xs text-sky-700">
                        {selectedLocationName ?? "Pin selected on the map"}
                      </p>
                      <p className="mt-1 text-[11px] text-sky-600">
                        {selectedLatitude.toFixed(5)}, {selectedLongitude.toFixed(5)}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100">
                    <div className="h-[min(52vh,390px)] min-h-[300px] w-full">
                      <LocationPicker
                        latitude={selectedLatitude}
                        longitude={selectedLongitude}
                        onPick={handleMapPick}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">
                    Click anywhere on the map or drag the pin to fine-tune the location.
                  </p>
                  {selectedLatitude !== null && selectedLongitude !== null && (
                    <p className="mt-1 text-xs font-medium text-sky-700">
                      Pin: {selectedLatitude.toFixed(5)}, {selectedLongitude.toFixed(5)}
                    </p>
                  )}
                </div>
              )}

              {error && <p className="mt-3 text-xs font-medium text-red-600" role="alert">{error}</p>}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 bg-neutral-50 px-5 py-3">
              <button
                type="button"
                onClick={clearLocation}
                disabled={isPending || (selectedLatitude === null && selectedLongitude === null)}
                className="text-sm font-medium text-red-600 transition-colors hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove location
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={isPending}
                  className="rounded-lg px-3 py-2 text-sm text-neutral-600 transition-colors hover:bg-white hover:text-neutral-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isPending}
                  className={`${btnPrimary} w-auto`}
                >
                  {isPending ? "Saving…" : "Save location"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
