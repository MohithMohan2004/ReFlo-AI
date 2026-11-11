import { useEffect, useMemo, useState } from "react";
import { Marker, Polyline, Popup } from "react-leaflet";
import type { LatLngTuple } from "leaflet";
import {
  ClipboardList, Droplets, FileText, MapPinned, Phone, RefreshCw, RotateCcw, Search, Truck, X, CircleCheck,
} from "lucide-react";
import { AppShell } from "../components/AppShell";
import { roleNav } from "../components/nav";
import { UserMenu } from "../components/UserMenu";
import { FitBounds, InvalidateOnResize, MapFrame, pinIcon } from "../components/map";
import { Dialog } from "../components/Dialog";
import { Badge, Empty, Notice, Segmented, SkeletonRows, Spinner, Stat, StatusBadge } from "../components/ui";
import { ApiError, getJSON } from "../lib/api";
import { useSession } from "../lib/session";
import { useToast } from "../lib/toast";
import { useAsync } from "../lib/useAsync";
import { num, when } from "../lib/format";
import { applyFilter, bucketOf, filterOptions, type OrderFilter } from "../lib/orders";
import { toPoint, useRoute } from "../lib/route";
import "./orders.css";

/** One order as returned by /api/my_orders (buyer) or /api/stp_orders (plant). */
interface Order {
  order_id: string; status: string; location?: string; stp_id?: string; stp_name?: string;
  quantity_kld?: string; quality?: string; water_type?: string; created_at?: string; payment_status?: string;
  total?: string; buyer_name?: string; buyer_phone?: string; delivery_lat?: string; delivery_lon?: string;
  tanker_operator_id?: string;
}
interface Tracking {
  success: boolean; status?: string;
  stp?: { name?: string; latitude: number; longitude: number };
  delivery?: { latitude: number; longitude: number; location?: string };
}
interface TankerFix {
  success: boolean; tanker_assigned?: boolean;
  location?: { latitude: number; longitude: number; speed?: number | null; recorded_at?: string; updated_at?: string } | null;
}

const POLL_MS = 10000;
const GPS_MS = 5000;
const STEPS = ["Order placed", "Plant accepted", "Out for delivery", "Delivered"];

const norm = (s?: string) => String(s ?? "").trim().toLowerCase().replace(/_/g, " ");
function stepOf(status?: string) {
  const s = norm(status);
  if (s === "rejected") return -1;
  if (["expired", "cancelled", "canceled", "failed"].includes(s)) return -2;
  if (s === "accepted") return 1;
  if (s === "out for delivery") return 2;
  if (s === "delivered") return 3;
  return 0;
}
const rupees = (v?: string) => {
  const n = Number(v);
  return v && Number.isFinite(n) ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
};
function payment(p?: string) {
  const s = norm(p);
  if (s.includes("paid")) return <Badge tone="success">Paid</Badge>;
  if (s.includes("cash") || s.includes("cod")) return <Badge tone="info">Cash on delivery</Badge>;
  return <Badge tone="warning">Unpaid</Badge>;
}

export default function Orders() {
  const user = useSession();
  const isPlant = window.location.pathname.startsWith("/stp_track");
  const params = new URLSearchParams(window.location.search);
  const stpId = params.get("stp_id") ?? "";
  const endpoint = isPlant ? `/api/stp_orders${stpId ? `?stp_id=${encodeURIComponent(stpId)}` : ""}` : "/api/my_orders";

  const load = (s?: AbortSignal) =>
    getJSON<Order[] | { orders: Order[] }>(endpoint, s).then((d) => (Array.isArray(d) ? d : d.orders ?? []));
  const r = useAsync(load);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(params.get("order_id"));

  // Quiet refresh: keep the list (and any open map) in place while new data arrives.
  useEffect(() => { if (r.data) setUpdated(new Date()); }, [r.data]);
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.hidden) return;
      load().then((d) => r.setData(d)).catch(() => { /* keep the last good list */ });
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [endpoint]); // eslint-disable-line react-hooks/exhaustive-deps

  // A 403 means the wrong role's page; send people to their own.
  useEffect(() => {
    if (r.error && user?.logged_in) {
      if (isPlant && user.role !== "stp") window.location.replace("/track");
    }
  }, [r.error, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const orders = r.data ?? [];
  const delivered = orders.filter((o) => norm(o.status) === "delivered");
  const kld = delivered.reduce((a, o) => a + (Number(o.quantity_kld) || 0), 0);
  const active = orders.filter((o) => bucketOf(o.status) === "active").length;
  const pending = orders.filter((o) => bucketOf(o.status) === "pending").length;

  const q = query.trim().toLowerCase();
  const visible = applyFilter(orders, filter, (o) => o.status).filter(
    (o) => !q || [o.order_id, o.stp_name, o.location, o.buyer_name].some((f) => String(f ?? "").toLowerCase().includes(q)),
  );

  const nav = roleNav[isPlant ? "stp" : "demand"]!;
  return (
    <AppShell
      nav={nav}
      title={isPlant ? "Order tracking" : "My orders"}
      subtitle={isPlant ? "Orders for your plant and the tankers delivering them" : "Track your water deliveries and invoices"}
      actions={
        <>
          <button type="button" className="btn btn-ghost btn-icon" onClick={r.reload} aria-label="Refresh" title="Refresh">
            {r.loading ? <Spinner /> : <RefreshCw />}
          </button>
          <UserMenu />
        </>
      }
    >
      <main className="page orders-page">
        {r.error && <Notice tone="danger">{r.error}</Notice>}

        <section className="grid grid-4 stat-strip">
          <Stat icon={ClipboardList} label={isPlant ? "Orders" : "Orders placed"} value={r.data ? orders.length : "—"} hint={`${pending} awaiting acceptance`} />
          <Stat icon={Truck} label="In progress" value={r.data ? active : "—"} hint="Accepted or on the way" />
          <Stat icon={CircleCheck} label="Delivered" value={r.data ? delivered.length : "—"} hint="Completed orders" />
          <Stat icon={Droplets} label={isPlant ? "Water supplied" : "Water received"} value={r.data ? num(kld) : "—"} unit="KLD" hint="Across delivered orders" />
        </section>

        <section className="card mt-16">
          <header className="card-head wrap">
            <div>
              <h2>Orders</h2>
              <p>{updated ? `Updated ${updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes automatically` : "Newest first"}</p>
            </div>
            <div className="row wrap orders-tools">
              <div className="input-group orders-search">
                <Search size={15} />
                <input className="input" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder={isPlant ? "Search order, buyer or place" : "Search order, plant or place"} aria-label="Search orders" />
              </div>
              <Segmented<OrderFilter> label="Filter orders" value={filter} onChange={setFilter} options={filterOptions(orders, (o) => o.status)} />
            </div>
          </header>

          {r.loading && !r.data ? <SkeletonRows rows={4} /> : visible.length ? (
            <ul className="list">
              {visible.map((o) => (
                <OrderRow key={o.order_id} o={o} isPlant={isPlant} stpId={stpId}
                  open={open === o.order_id} onToggle={() => setOpen((v) => (v === o.order_id ? null : o.order_id))} />
              ))}
            </ul>
          ) : orders.length ? (
            <Empty icon={Search} title="No matching orders">Try another filter or search.</Empty>
          ) : (
            <Empty icon={ClipboardList} title="No orders yet"
              action={!isPlant ? <a className="btn btn-primary" href="/demand">Order water</a> : undefined}>
              {isPlant ? "Orders placed with your plant appear here." : "Orders you place appear here, with live tracking once a tanker is on the way."}
            </Empty>
          )}
        </section>
      </main>
    </AppShell>
  );
}

function OrderRow({ o, isPlant, stpId, open, onToggle }: { o: Order; isPlant: boolean; stpId: string; open: boolean; onToggle: () => void }) {
  const step = stepOf(o.status);
  const [reorder, setReorder] = useState(false);
  return (
    <li className="list-row order-row" data-open={open}>
      <div className="order-top">
        <div className="order-id">
          <span className="order-icon"><ClipboardList size={16} /></span>
          <div>
            <strong className="num">{o.order_id}</strong>
            <span className="muted">{when(o.created_at)}</span>
          </div>
        </div>
        <StatusBadge status={o.status} />
      </div>

      <dl className="order-facts">
        <div><dt>{isPlant ? "Buyer" : "Plant"}</dt><dd>{(isPlant ? o.buyer_name : o.stp_name) || "—"}</dd></div>
        <div><dt>Quantity</dt><dd className="num">{num(o.quantity_kld)} KLD{o.quality ? ` · ${o.quality}` : ""}</dd></div>
        <div className="wide"><dt>Deliver to</dt><dd title={o.location}>{o.location || "—"}</dd></div>
        <div><dt>Amount</dt><dd className="num">{rupees(o.total)}</dd></div>
        <div><dt>Payment</dt><dd>{payment(o.payment_status)}</dd></div>
      </dl>

      {step === -1 ? (
        <Notice tone="danger">This order was rejected by the plant.</Notice>
      ) : step === -2 ? (
        <Notice tone="warning">This order {norm(o.status) === "expired" ? "expired before it was accepted and delivered" : `was ${norm(o.status)}`}. Use Reorder to place it again.</Notice>
      ) : (
        <ol className="order-steps" aria-label="Order progress">
          {STEPS.map((label, i) => (
            <li key={label} data-state={i < step || step === 3 ? "done" : i === step ? "current" : "todo"}>
              <span className="dot">{i < step || step === 3 ? <CircleCheck size={14} /> : i + 1}</span>
              <span className="label">{label}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="order-actions">
        {step >= 0 && (
          <button type="button" className={`btn btn-sm ${open ? "btn-secondary" : "btn-primary"}`} onClick={onToggle} aria-expanded={open}>
            {open ? <><X /> Hide map</> : <><MapPinned /> Track</>}
          </button>
        )}
        <a className="btn btn-sm btn-secondary" href={`/invoice?order_id=${encodeURIComponent(o.order_id)}`}><FileText /> Invoice</a>
        {isPlant && o.buyer_phone && <a className="btn btn-sm btn-ghost" href={`tel:${o.buyer_phone}`}><Phone /> Call buyer</a>}
        {!isPlant && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setReorder(true)}><RotateCcw /> Reorder</button>}
      </div>

      {open && <TrackPanel o={o} stpId={stpId} />}
      {reorder && <ReorderDialog o={o} onClose={() => setReorder(false)} />}
    </li>
  );
}

/* ---------- Live tracking ---------- */

async function geocode(q: string): Promise<LatLngTuple | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { Accept: "application/json" } });
    const d = await r.json();
    return d.length ? [Number(d[0].lat), Number(d[0].lon)] : null;
  } catch { return null; }
}

function km(a: LatLngTuple, b: LatLngTuple) {
  const R = 6371, t = (v: number) => (v * Math.PI) / 180;
  const h = Math.sin(t(b[0] - a[0]) / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(t(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function TrackPanel({ o, stpId }: { o: Order; stpId: string }) {
  const [ends, setEnds] = useState<{ stp: LatLngTuple; drop: LatLngTuple; stpName: string; dropName: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fix, setFix] = useState<TankerFix | null>(null);
  const onTheWay = norm(o.status) === "out for delivery";
  const done = norm(o.status) === "delivered";

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const t = await getJSON<Tracking>(`/api/order_tracking/${encodeURIComponent(o.order_id)}${stpId ? `?stp_id=${encodeURIComponent(stpId)}` : ""}`);
        if (!live) return;
        const stp = toPoint(t.stp?.latitude, t.stp?.longitude);
        const drop = toPoint(t.delivery?.latitude, t.delivery?.longitude);
        if (stp && drop) return setEnds({ stp, drop, stpName: t.stp?.name || o.stp_name || "Plant", dropName: t.delivery?.location || o.location || "Delivery point" });
        throw new Error("no coordinates");
      } catch (e) {
        // Older orders have only an address: look it up, as the old page did.
        if (e instanceof ApiError && e.status === 401) return;
        const [stp, drop] = await Promise.all([
          geocode(`${o.stp_name ?? ""}, Bengaluru, Karnataka, India`),
          geocode(`${o.location ?? ""}, Bengaluru, Karnataka, India`),
        ]);
        if (!live) return;
        if (stp && drop) setEnds({ stp, drop, stpName: o.stp_name || "Plant", dropName: o.location || "Delivery point" });
        else setErr("The plant or delivery location for this order couldn't be found on the map.");
      }
    })();
    return () => { live = false; };
  }, [o.order_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live GPS of the tanker assigned to this order, while it is on the way.
  useEffect(() => {
    if (!onTheWay) { setFix(null); return; }
    let live = true;
    const poll = () => getJSON<TankerFix>(`/api/order_tracking/${encodeURIComponent(o.order_id)}/tanker_location`)
      .then((d) => live && setFix(d)).catch(() => live && setFix({ success: false }));
    poll();
    const t = window.setInterval(() => !document.hidden && poll(), GPS_MS);
    return () => { live = false; window.clearInterval(t); };
  }, [o.order_id, onTheWay]);

  const { route, loading } = useRoute(ends?.stp, ends?.drop);
  const truck = toPoint(fix?.location?.latitude, fix?.location?.longitude);

  // Split the road route at the tanker: covered part muted, the rest highlighted.
  const split = useMemo(() => {
    if (!route || !truck) return null;
    let best = 0, bestD = Infinity;
    route.coords.forEach((p, i) => { const d = (p[0] - truck[0]) ** 2 + (p[1] - truck[1]) ** 2; if (d < bestD) { bestD = d; best = i; } });
    const ahead = route.coords.slice(best);
    let left = 0;
    for (let i = 0; i < ahead.length - 1; i++) left += km(ahead[i]!, ahead[i + 1]!);
    const speed = Number(fix?.location?.speed);
    const kmh = Number.isFinite(speed) && speed > 1 ? speed * 3.6 : 25;
    return { behind: route.coords.slice(0, best + 1), ahead, left, mins: Math.max(1, Math.round((left / kmh) * 60)) };
  }, [route, truck?.[0], truck?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = done ? "Delivered"
    : onTheWay ? (truck ? "Tanker on the way · live" : fix?.tanker_assigned === false ? "Waiting for a tanker" : "Waiting for the tanker's GPS")
    : norm(o.status) === "accepted" ? "Plant accepted · waiting for pickup"
    : "Waiting for the plant to accept";

  const bounds = useMemo<LatLngTuple[] | null>(() => (ends ? [ends.stp, ends.drop] : null), [ends]);

  return (
    <div className="track-panel">
      {err ? <Notice tone="warning">{err}</Notice> : (
        <>
          <div className="track-map">
            <MapFrame height="100%" scrollZoom>
              <InvalidateOnResize />
              <FitBounds bounds={bounds} fitKey={o.order_id + (ends ? "1" : "0")} />
              {route && !split && <Polyline positions={route.coords} pathOptions={{ color: "#1463d6", weight: 5, opacity: 0.9 }} />}
              {split && <Polyline positions={split.behind} pathOptions={{ color: "#8a97a8", weight: 5, opacity: 0.8 }} />}
              {split && <Polyline positions={split.ahead} pathOptions={{ color: "#1463d6", weight: 5, opacity: 0.95 }} />}
              {ends && <Marker position={ends.stp} icon={pinIcon("plant", "success")}><Popup><strong>Pickup</strong><br />{ends.stpName}</Popup></Marker>}
              {ends && <Marker position={ends.drop} icon={pinIcon("home", "brand")}><Popup><strong>Delivery</strong><br />{ends.dropName}</Popup></Marker>}
              {truck && <Marker position={truck} icon={pinIcon("truck", "ink")} zIndexOffset={1000} />}
              {done && ends && !truck && <Marker position={ends.drop} icon={pinIcon("truck", "ink")} zIndexOffset={1000} />}
            </MapFrame>
            {!ends && <div className="track-loading"><Spinner /> Loading route…</div>}
          </div>
          <dl className="track-figs">
            <div><dt>{split ? "Distance left" : "Distance"}</dt><dd className="num">{split ? `${num(split.left, 1)} km` : route ? `${num(route.km, 1)} km` : loading ? "…" : "—"}</dd></div>
            <div><dt>{split ? "Arrives in" : "Drive time"}</dt><dd className="num">{split ? `${split.mins} min` : route ? `${Math.max(1, Math.round(route.mins))} min` : "—"}</dd></div>
            <div className="wide"><dt>Status</dt><dd><span className="track-live" data-on={!!truck} />{status}</dd></div>
          </dl>
        </>
      )}
    </div>
  );
}

function ReorderDialog({ o, onClose }: { o: Order; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const res = await fetch(`/reorder/${encodeURIComponent(o.order_id)}`, { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
      if (res.status === 401) { window.location.href = "/login"; return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.new_order_id) throw new Error(data.error || "Unable to reorder. Please try again.");
      window.location.href = `/invoice?order_id=${encodeURIComponent(data.new_order_id)}`;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Unable to reorder.", "danger");
      setBusy(false);
    }
  }
  return (
    <Dialog title="Reorder" onClose={onClose}>
      <div className="stack">
        <p>Place a new order with the same plant, quantity, quality and delivery location?</p>
        <dl className="order-facts compact">
          <div><dt>Plant</dt><dd>{o.stp_name || "—"}</dd></div>
          <div><dt>Quantity</dt><dd className="num">{num(o.quantity_kld)} KLD</dd></div>
          <div className="wide"><dt>Deliver to</dt><dd>{o.location || "—"}</dd></div>
        </dl>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={go} disabled={busy}>{busy ? <Spinner /> : <RotateCcw />} Place order</button>
        </div>
      </div>
    </Dialog>
  );
}
