import type { LatLngTuple } from "leaflet";

/** True inside the ReFlow Android app (Capacitor shell). */
export function isNativeApp(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/**
 * Open turn-by-turn directions in Google Maps, starting from the driver's
 * current position. In the Android app, Capacitor hands any non-ReFlow URL to
 * Android, which opens it in the Google Maps app; in a browser it opens a tab.
 */
export function openGoogleMapsNavigation(destination: LatLngTuple, via?: LatLngTuple | null) {
  const params = new URLSearchParams({
    api: "1",
    destination: `${destination[0]},${destination[1]}`,
    travelmode: "driving",
    dir_action: "navigate",
  });
  if (via) params.set("waypoints", `${via[0]},${via[1]}`);
  const url = `https://www.google.com/maps/dir/?${params.toString()}`;

  if (isNativeApp()) {
    window.location.href = url;
  } else {
    window.open(url, "_blank", "noopener");
  }
}
