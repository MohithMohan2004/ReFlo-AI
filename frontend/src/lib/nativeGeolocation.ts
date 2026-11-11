// Inside the ReFlow Android app the pages load from the Flask server, and
// Android's WebView blocks navigator.geolocation on plain-http origins. When
// the native Geolocation plugin is present, route the standard browser API
// through it so the existing pages (tanker live tracking, "use my location")
// work unchanged. In a normal browser this file does nothing.

type NativePosition = {
  timestamp: number;
  coords: {
    latitude: number; longitude: number; accuracy: number;
    altitude: number | null; altitudeAccuracy?: number | null;
    speed: number | null; heading: number | null;
  };
};

type Bridge = {
  isNativePlatform?: () => boolean;
  PluginHeaders?: { name: string }[];
  nativePromise: (plugin: string, method: string, options?: unknown) => Promise<unknown>;
  nativeCallback: (plugin: string, method: string, options: unknown, cb: (data: unknown, err?: { message?: string }) => void) => string;
};

const PLUGIN = "Geolocation";

function toPosition(p: NativePosition): GeolocationPosition {
  const c = p.coords;
  const coords = {
    latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy,
    altitude: c.altitude ?? null, altitudeAccuracy: c.altitudeAccuracy ?? null,
    speed: c.speed ?? null, heading: c.heading ?? null,
  };
  return { timestamp: p.timestamp, coords: { ...coords, toJSON: () => coords }, toJSON: () => ({ timestamp: p.timestamp, coords }) } as GeolocationPosition;
}

function toError(err: unknown): GeolocationPositionError {
  const message = (err as { message?: string } | undefined)?.message ?? "Location unavailable";
  const code = /denied|permission/i.test(message) ? 1 : /timeout/i.test(message) ? 3 : 2;
  return { code, message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
}

function nativeOptions(o?: PositionOptions) {
  return { enableHighAccuracy: o?.enableHighAccuracy ?? false, timeout: o?.timeout ?? 10000, maximumAge: o?.maximumAge ?? 0 };
}

export function installNativeGeolocation() {
  const cap = (window as unknown as { Capacitor?: Bridge }).Capacitor;
  if (!cap?.isNativePlatform?.() || !cap.PluginHeaders?.some((h) => h.name === PLUGIN)) return;

  const watches = new Map<number, string>();
  let nextId = 1;

  const geolocation: Geolocation = {
    getCurrentPosition(success, error, options) {
      cap.nativePromise(PLUGIN, "getCurrentPosition", nativeOptions(options))
        .then((p) => success(toPosition(p as NativePosition)))
        .catch((e) => error?.(toError(e)));
    },
    watchPosition(success, error, options) {
      const id = nextId++;
      const callbackId = cap.nativeCallback(PLUGIN, "watchPosition", nativeOptions(options), (data, err) => {
        if (err || !data) error?.(toError(err));
        else success(toPosition(data as NativePosition));
      });
      watches.set(id, callbackId);
      return id;
    },
    clearWatch(id) {
      const callbackId = watches.get(id);
      if (callbackId === undefined) return;
      watches.delete(id);
      void cap.nativePromise(PLUGIN, "clearWatch", { id: callbackId }).catch(() => undefined);
    },
  };

  Object.defineProperty(navigator, "geolocation", { value: geolocation, configurable: true });
}
