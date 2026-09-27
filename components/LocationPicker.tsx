"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";

const DEFAULT_CENTER: L.LatLngExpression = [39.8283, -98.5795];
const DEFAULT_ZOOM = 4;

interface LocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  onPick: (latitude: number, longitude: number) => void;
}

export default function LocationPicker({ latitude, longitude, onPick }: LocationPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onPickRef = useRef(onPick);

  onPickRef.current = onPick;

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const initialPosition: L.LatLngExpression =
      latitude !== null && longitude !== null ? [latitude, longitude] : DEFAULT_CENTER;
    const map = L.map(mapContainerRef.current, {
      center: initialPosition,
      zoom: latitude !== null && longitude !== null ? 13 : DEFAULT_ZOOM,
      zoomControl: true,
    });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    const pinIcon = L.divIcon({
      className: "location-picker-pin",
      html: '<div class="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-sky-600 text-lg text-white shadow-lg">📍</div>',
      iconSize: [36, 36],
      iconAnchor: [18, 36],
    });

    const setMarker = (nextLatitude: number, nextLongitude: number, pan = true) => {
      const position: L.LatLngExpression = [nextLatitude, nextLongitude];
      if (markerRef.current) {
        markerRef.current.setLatLng(position);
      } else {
        markerRef.current = L.marker(position, { draggable: true, icon: pinIcon }).addTo(map);
        markerRef.current.on("dragend", () => {
          const nextPosition = markerRef.current?.getLatLng();
          if (nextPosition) onPickRef.current(nextPosition.lat, nextPosition.lng);
        });
      }
      if (pan) map.panTo(position);
    };

    if (latitude !== null && longitude !== null) {
      setMarker(latitude, longitude, false);
    }

    map.on("click", (event: L.LeafletMouseEvent) => {
      setMarker(event.latlng.lat, event.latlng.lng);
      onPickRef.current(event.latlng.lat, event.latlng.lng);
    });

    const timer = setTimeout(() => map.invalidateSize(), 150);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || latitude === null || longitude === null) return;
    const position: L.LatLngExpression = [latitude, longitude];
    markerRef.current?.setLatLng(position);
    mapRef.current.panTo(position);
  }, [latitude, longitude]);

  return <div ref={mapContainerRef} className="h-full min-h-[300px] w-full" aria-label="Location picker map" />;
}
