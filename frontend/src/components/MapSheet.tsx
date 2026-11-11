import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Phone layout breakpoint, shared with styles/mobile.css. */
const PHONE_QUERY = "(max-width: 760px)";

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

export type SheetSnap = "peek" | "half" | "full";

/** Move the sheet from anywhere, e.g. collapse it so a route on the map is visible. */
export function setSheet(snap: SheetSnap) {
  window.dispatchEvent(new CustomEvent<SheetSnap>("reflow:sheet", { detail: snap }));
}

// Apple's momentum projection (skill.md §6): where a flick would come to rest.
const project = (v: number, d = 0.998) => ((v / 1000) * d) / (1 - d);
// Progressive resistance past the ends (skill.md §9).
const rubber = (over: number, dim: number, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

/**
 * Uber-style bottom sheet over a full-screen map (phones only).
 * On wider screens it renders its children unchanged, so desktop layouts stay as they are.
 *
 * Drag anywhere on the sheet to move it between three heights; once fully open
 * the content scrolls, and the grab handle pulls it back down.
 */
export function MapSheet({ peek = 300, children, label = "Details" }: { peek?: number; children: ReactNode; label?: string }) {
  const phone = useIsPhone();
  if (!phone) return <>{children}</>;
  return <Sheet peek={peek} label={label}>{children}</Sheet>;
}

function Sheet({ peek, label, children }: { peek: number; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const y = useRef(0);
  const height = useRef(0);
  const drag = useRef<{ id: number; startY: number; startOffset: number; moved: boolean; hist: { t: number; y: number }[] } | null>(null);
  const suppressClick = useRef(false);

  const offsets = useCallback((): Record<SheetSnap, number> => {
    const H = height.current;
    const peekV = Math.min(peek, H * 0.7);
    const halfV = Math.min(H, Math.max(H * 0.62, peekV + 96));
    return { full: 0, half: H - halfV, peek: H - peekV };
  }, [peek]);

  const apply = useCallback((offset: number, animate: boolean) => {
    const el = ref.current;
    if (!el) return;
    y.current = offset;
    el.style.transition = animate ? "transform 460ms cubic-bezier(0.2, 0.9, 0.25, 1)" : "none";
    el.style.transform = `translate3d(0, ${offset}px, 0)`;
  }, []);

  const goTo = useCallback((s: SheetSnap, animate = true) => {
    setSnap(s);
    apply(offsets()[s], animate);
  }, [apply, offsets]);

  // Measure, then slide in from below on mount.
  useLayoutEffect(() => {
    const el = ref.current!;
    height.current = el.clientHeight;
    apply(height.current, false);
    const raf = requestAnimationFrame(() => goTo("peek"));
    const ro = new ResizeObserver(() => {
      height.current = el.clientHeight;
      if (!drag.current) apply(offsets()[snapRef.current], false);
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const snapRef = useRef(snap);
  snapRef.current = snap;

  // Content above the fold changed size (e.g. a job appeared): keep the peek honest.
  useEffect(() => {
    if (snapRef.current === "peek" && !drag.current && height.current) apply(offsets().peek, true);
  }, [peek, apply, offsets]);

  useEffect(() => {
    const on = (e: Event) => goTo((e as CustomEvent<SheetSnap>).detail);
    window.addEventListener("reflow:sheet", on);
    return () => window.removeEventListener("reflow:sheet", on);
  }, [goTo]);

  /* ---------- Gesture: track 1:1, hand off velocity, project, snap ---------- */
  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const fromHandle = (e.target as HTMLElement).closest(".sheet-grab");
    // Fully open: the content scrolls; only the handle moves the sheet.
    if (snapRef.current === "full" && !fromHandle) return;
    drag.current = { id: e.pointerId, startY: e.clientY, startOffset: y.current, moved: false, hist: [{ t: e.timeStamp, y: e.clientY }] };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.abs(dy) < 8) return; // hysteresis: a tap stays a tap
      d.moved = true;
      ref.current?.setPointerCapture(e.pointerId);
    }
    d.hist.push({ t: e.timeStamp, y: e.clientY });
    if (d.hist.length > 6) d.hist.shift();
    const max = offsets().peek;
    let next = d.startOffset + dy;
    if (next < 0) next = -rubber(-next, height.current);
    else if (next > max) next = max + rubber(next - max, height.current);
    apply(next, false);
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || !d.moved) return;
    suppressClick.current = true;
    const first = d.hist[0]!, last = d.hist[d.hist.length - 1]!;
    const dt = Math.max(1, last.t - first.t);
    const velocity = ((last.y - first.y) / dt) * 1000; // px/s, + is down
    const target = y.current + project(velocity);
    const o = offsets();
    const best = (Object.keys(o) as SheetSnap[]).reduce((a, b) => (Math.abs(o[b] - target) < Math.abs(o[a] - target) ? b : a));
    goTo(best);
  }

  // Typing needs room: open fully when a field takes focus.
  function onFocusCapture(e: React.FocusEvent) {
    if ((e.target as HTMLElement).matches("input, select, textarea") && snapRef.current !== "full") goTo("full");
  }

  // A drag that ends over a button must not also press it.
  function onClickCapture(e: React.MouseEvent) {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }

  return (
    <div
      ref={ref}
      className="sheet"
      data-snap={snap}
      role="region"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture}
      onFocusCapture={onFocusCapture}
    >
      <button
        type="button"
        className="sheet-grab"
        aria-label={snap === "full" ? "Collapse panel" : "Expand panel"}
        onClick={() => goTo(snap === "full" ? "peek" : snap === "peek" ? "half" : "full")}
      >
        <span />
      </button>
      <div ref={bodyRef} className="sheet-body cascade">{children}</div>
    </div>
  );
}
