import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

/* Light / dark theme. The preference is kept per device in localStorage
   ("system" follows the OS). index.html applies it before first paint. */
export type ThemePref = "system" | "light" | "dark";

const KEY = "reflow-theme";
const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch { /* storage blocked */ }
  return "system";
}

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && !!media?.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#080e19" : "#0b1626");
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch { /* storage blocked */ }
  apply(pref);
  window.dispatchEvent(new Event("reflow:theme"));
}

/** Keeps the page in sync with the OS setting while the preference is "system". */
export function installTheme() {
  apply(getThemePref());
  media?.addEventListener("change", () => getThemePref() === "system" && apply("system"));
  window.addEventListener("storage", (e) => e.key === KEY && apply(getThemePref()));
}

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState(getThemePref);
  useEffect(() => {
    const sync = () => setPref(getThemePref());
    window.addEventListener("reflow:theme", sync);
    return () => window.removeEventListener("reflow:theme", sync);
  }, []);
  return [pref, setThemePref];
}

const OPTIONS = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

export function ThemeSwitch() {
  const [pref, setPref] = useThemePref();
  return (
    <div className="theme-switch" role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button key={value} type="button" aria-pressed={pref === value} onClick={() => setPref(value)}>
          <Icon aria-hidden="true" /> {label}
        </button>
      ))}
    </div>
  );
}
