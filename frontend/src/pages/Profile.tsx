import { useState, type FormEvent } from "react";
import { Marker } from "react-leaflet";
import {
  AtSign, Building2, CircleCheck, ClipboardList, Droplets, Factory, Gauge, IdCard, LogOut, Pencil, Mail, MapPin, Phone,
  KeyRound, Radar, ShieldCheck, Truck, Unplug, Wifi,
} from "lucide-react";
import { AppShell } from "../components/AppShell";
import { publicNav, roleNav } from "../components/nav";
import { Avatar, ROLE_META, UserMenu } from "../components/UserMenu";
import { InvalidateOnResize, MapFrame, pinIcon } from "../components/map";
import { Empty, Notice, SkeletonRows, StatusBadge } from "../components/ui";
import { Dialog } from "../components/Dialog";
import { LocationPicker, type PickedPoint } from "../components/LocationPicker";
import { getJSON, postJSON } from "../lib/api";
import { useToast } from "../lib/toast";
import { useAsync } from "../lib/useAsync";
import { initials, num, when } from "../lib/format";
import type { Stp } from "../lib/types";
import { ThemeSwitch } from "../lib/theme";
import "./profile.css";

interface ProfileData {
  user_id: string; first_name: string; last_name: string; name: string; username: string; email: string;
  mobile: string; role: string; plant: Stp | null;
  operator: Record<string, string | number | null> | null;
}
interface MyOrder { order_id: string; status: string; stp_name: string; quantity_kld: string; created_at: string }

export default function Profile() {
  const p = useAsync((s) => getJSON<ProfileData>("/api/profile", s));
  const role = p.data?.role ?? "";
  const meta = ROLE_META[role];
  const nav = roleNav[role] ?? publicNav;
  const [editing, setEditing] = useState(false);

  return (
    <AppShell nav={nav} title="Profile" subtitle="Your account and organisation details" actions={<UserMenu />}>
      <main className="page page-narrow profile">
        {p.error && <Notice tone="danger">{p.error}</Notice>}

        <section className="card profile-hero" data-tone={meta?.tone ?? "blue"}>
          <div className="profile-hero-band" aria-hidden="true" />
          <div className="profile-hero-body">
            {p.data ? (
              <Avatar initials={initials(p.data.name)} role={role} size={76} />
            ) : (
              <div className="skeleton" style={{ width: 76, height: 76, borderRadius: "50%" }} />
            )}
            <div className="profile-id">
              <h2>{p.data?.name ?? " "}</h2>
              <div className="row wrap" style={{ gap: 8 }}>
                {meta && <span className="role-chip" data-tone={meta.tone}>{meta.label}</span>}
                <span className="badge" data-tone="success">Active</span>
              </div>
            </div>
            <div className="profile-actions">
              {p.data && <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}><Pencil /> Edit profile</button>}
              {meta && <a className="btn btn-secondary" href={meta.home}>Open dashboard</a>}
              <a className="btn btn-danger" href="/logout"><LogOut /> Sign out</a>
            </div>
          </div>
          <dl className="profile-facts">
            <Fact icon={Mail} label="Email" value={p.data?.email} />
            <Fact icon={Phone} label="Mobile" value={p.data?.mobile} />
            <Fact icon={AtSign} label="Username" value={p.data?.username} />
            <Fact icon={IdCard} label="Account ID" value={p.data?.user_id ? p.data.user_id.slice(0, 8).toUpperCase() : undefined} mono />
          </dl>
        </section>

        {p.loading && !p.data ? (
          <div className="card"><SkeletonRows rows={3} /></div>
        ) : role === "demand" ? (
          <DemandSummary />
        ) : role === "stp" ? (
          <>
            <PlantCard plant={p.data?.plant ?? null} onSaved={p.reload} />
            {p.data?.plant && <OcemsFeedCard />}
          </>
        ) : role === "tanker" ? (
          <OperatorCard op={p.data?.operator ?? null} />
        ) : null}

        <section className="card">
          <header className="card-head">
            <div><h2>Appearance</h2><p>Choose how ReFlow looks on this device</p></div>
          </header>
          <div style={{ padding: "14px 20px 18px" }}><ThemeSwitch /></div>
        </section>

        <p className="profile-note">
          <ShieldCheck size={14} /> Your email is your sign-in and can't be changed here. Edits to your name apply to new
          orders and activity; existing records keep the name they were created with.
        </p>
      </main>
      {editing && p.data && (
        <EditDialog data={p.data} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); window.location.reload(); }} />
      )}
    </AppShell>
  );
}

function EditDialog({ data, onClose, onSaved }: { data: ProfileData; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ first_name: data.first_name, last_name: data.last_name, username: data.username, mobile: data.mobile });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await postJSON("/api/profile", f);
      toast("Profile updated.", "success");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save profile", "danger");
      setSaving(false);
    }
  }
  return (
    <Dialog title="Edit profile" onClose={onClose}>
      <form onSubmit={save} className="stack">
        <div className="grid grid-2">
          <label className="field"><span className="field-label">First name</span><input className="input" required value={f.first_name} onChange={set("first_name")} /></label>
          <label className="field"><span className="field-label">Last name</span><input className="input" value={f.last_name} onChange={set("last_name")} /></label>
        </div>
        <label className="field"><span className="field-label">Username</span><input className="input" value={f.username} onChange={set("username")} /></label>
        <label className="field"><span className="field-label">Mobile</span><input className="input" inputMode="tel" value={f.mobile} onChange={set("mobile")} placeholder="+91 98765 43210" /></label>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </Dialog>
  );
}

function Fact({ icon: Icon, label, value, mono }: { icon: typeof Mail; label: string; value?: string; mono?: boolean }) {
  return (
    <div>
      <dt><Icon size={14} /> {label}</dt>
      <dd className={mono ? "num" : undefined}>{value || <span className="muted">Not provided</span>}</dd>
    </div>
  );
}

function DemandSummary() {
  const o = useAsync((s) => getJSON<MyOrder[]>("/api/my_orders", s));
  const list = o.data ?? [];
  const active = list.filter((x) => ["Pending", "Accepted", "Out for Delivery"].includes(x.status)).length;
  const done = list.filter((x) => x.status === "Delivered");
  const kld = done.reduce((a, x) => a + (Number(x.quantity_kld) || 0), 0);
  return (
    <section className="card">
      <header className="card-head">
        <div><h2>Your water orders</h2><p>Lifetime activity for this account</p></div>
        <a className="btn btn-sm btn-ghost" href="/track">All orders</a>
      </header>
      <div className="mini-stats">
        <Mini icon={ClipboardList} tone="blue" label="Orders placed" value={num(list.length)} />
        <Mini icon={Truck} tone="amber" label="In progress" value={num(active)} />
        <Mini icon={CircleCheck} tone="teal" label="Delivered" value={num(done.length)} />
        <Mini icon={Droplets} tone="sky" label="Water received" value={num(kld)} unit="KLD" />
      </div>
      {list.length ? (
        <ul className="list">
          {list.slice(0, 5).map((x) => (
            <li key={x.order_id} className="list-row row-between">
              <span>
                <strong className="num" style={{ fontSize: 13.5 }}>{x.order_id}</strong>
                <span className="muted" style={{ display: "block", fontSize: 12.5 }}>{num(x.quantity_kld)} KLD · {x.stp_name} · {when(x.created_at)}</span>
              </span>
              <StatusBadge status={x.status} />
            </li>
          ))}
        </ul>
      ) : !o.loading && <Empty icon={ClipboardList} title="No orders yet">Orders you place appear here.</Empty>}
    </section>
  );
}

function PlantCard({ plant, onSaved }: { plant: Stp | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  if (!plant) return <div className="card"><Empty icon={Factory} title="No plant linked">This account isn't linked to a treatment plant yet.</Empty></div>;
  const total = (Number(plant.total_capacity_mld) || 0) * 1000;
  const avail = (Number(plant.available_capacity_mld) || 0) * 1000;
  return (
    <section className="card org-card">
      <div className="org-body">
        <header className="card-head" style={{ borderBottom: 0, padding: "18px 20px 6px" }}>
          <div><h2>{plant.stp_name}</h2><p className="num">{plant.stp_id}</p></div>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="role-chip" data-tone="teal">{plant.quality_grade || "General"} grade</span>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setEditing(true)}><Pencil size={15} /> Edit details</button>
          </div>
        </header>
        <div className="mini-stats">
          <Mini icon={Gauge} tone="teal" label="Capacity" value={num(total)} unit="KLD" />
          <Mini icon={Droplets} tone="sky" label="Available" value={num(avail)} unit="KLD" />
          <Mini icon={Factory} tone="violet" label="Technology" value={plant.technology && plant.technology !== "Not Specified" ? plant.technology : "—"} small />
          <Mini icon={Building2} tone="amber" label="Treatment cost" value={plant.treatment_cost_per_kl != null ? `₹${num(plant.treatment_cost_per_kl, 1)}` : "—"} unit="/ KL" />
        </div>
      </div>
      {plant.latitude && plant.longitude && (
        <MapFrame center={[plant.latitude, plant.longitude]} zoom={14} className="org-map">
          <InvalidateOnResize />
          <Marker position={[plant.latitude, plant.longitude]} icon={pinIcon("plant", "brand")} />
        </MapFrame>
      )}
      {editing && <PlantDialog plant={plant} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved(); }} />}
    </section>
  );
}

const GRADES = ["General", "Bronze", "Silver", "Gold"];

function PlantDialog({ plant, onClose, onSaved }: { plant: Stp; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const kld = (mld?: number) => (mld != null && Number.isFinite(Number(mld)) ? String(Math.round(Number(mld) * 1000 * 100) / 100) : "");
  const [f, setF] = useState({
    stp_name: plant.stp_name ?? "",
    technology: plant.technology && plant.technology !== "Not Specified" ? plant.technology : "",
    quality_grade: GRADES.includes(plant.quality_grade ?? "") ? plant.quality_grade! : "General",
    total_capacity_kld: kld(plant.total_capacity_mld),
    current_load_kld: kld(plant.current_load_mld ?? 0),
    treatment_cost_per_kl: plant.treatment_cost_per_kl != null ? String(plant.treatment_cost_per_kl) : "",
  });
  const [loc, setLoc] = useState<PickedPoint | null>(
    plant.latitude != null && plant.longitude != null ? { lat: plant.latitude, lon: plant.longitude, label: "Current location" } : null,
  );
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const total = Number(f.total_capacity_kld), load = Number(f.current_load_kld);
  const problem =
    !f.stp_name.trim() ? "Enter the plant name." :
    !f.technology.trim() ? "Describe the treatment technology." :
    !(total > 0) ? "Capacity must be greater than zero." :
    f.current_load_kld === "" || load < 0 ? "Enter the current load (0 or more)." :
    load > total ? "Current load can't exceed capacity." :
    f.treatment_cost_per_kl === "" || Number(f.treatment_cost_per_kl) < 0 ? "Enter the treatment cost." :
    !loc ? "Place the plant on the map." : null;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (problem) return toast(problem, "danger");
    setSaving(true);
    try {
      await postJSON("/api/stp/details", { stp_id: plant.stp_id, ...f, latitude: loc!.lat, longitude: loc!.lon });
      toast("Plant details saved.", "success");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save", "danger");
      setSaving(false);
    }
  }

  return (
    <Dialog title="Edit plant details" onClose={onClose}>
      <form onSubmit={save} className="stack" autoComplete="off">
        <label className="field"><span className="field-label">Plant name</span>
          <input className="input" required value={f.stp_name} onChange={set("stp_name")} />
        </label>
        <div className="plant-edit-grid">
          <label className="field"><span className="field-label">Technology</span>
            <input className="input" required value={f.technology} onChange={set("technology")} placeholder="e.g. 450 KLD SBR" />
          </label>
          <label className="field"><span className="field-label">Quality grade</span>
            <select className="select" value={f.quality_grade} onChange={set("quality_grade")}>
              {GRADES.map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">Total capacity (KLD)</span>
            <input className="input num" required type="number" min="0" step="any" inputMode="decimal" value={f.total_capacity_kld} onChange={set("total_capacity_kld")} />
          </label>
          <label className="field"><span className="field-label">Current load (KLD)</span>
            <input className="input num" required type="number" min="0" step="any" inputMode="decimal" value={f.current_load_kld} onChange={set("current_load_kld")} />
          </label>
          <label className="field"><span className="field-label">Treatment cost (₹ / KL)</span>
            <input className="input num" required type="number" min="0" step="any" inputMode="decimal" value={f.treatment_cost_per_kl} onChange={set("treatment_cost_per_kl")} />
          </label>
        </div>
        <div className="field"><span className="field-label">Location</span>
          <LocationPicker value={loc} onChange={setLoc} />
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save details"}</button>
        </div>
      </form>
    </Dialog>
  );
}

function OperatorCard({ op }: { op: Record<string, string | number | null> | null }) {
  if (!op) return <div className="card"><Empty icon={Truck} title="No operator record">This account isn't linked to a tanker registration.</Empty></div>;
  const lat = Number(op.latitude), lon = Number(op.longitude);
  return (
    <section className="card org-card">
      <div className="org-body">
        <header className="card-head" style={{ borderBottom: 0, padding: "18px 20px 6px" }}>
          <div><h2>{op.operator_name}</h2><p className="num">{op.operator_id} · {op.operator_type === "contracted" ? "Contracted partner" : "Independent operator"}</p></div>
          <StatusBadge status={String(op.verification_status || "pending")} />
        </header>
        <div className="mini-stats">
          <Mini icon={Truck} tone="violet" label="Fleet size" value={num(op.operational_tankers)} unit="tankers" />
          <Mini icon={Radar} tone="sky" label="Service radius" value={op.service_radius_km ? num(op.service_radius_km) : "—"} unit="km" />
          <Mini icon={Droplets} tone="teal" label="Water type" value={String(op.water_type_supported || "—")} small />
          <Mini icon={MapPin} tone="amber" label="Base area" value={`${op.area || "—"}${op.pincode ? ` · ${op.pincode}` : ""}`} small />
        </div>
      </div>
      {Number.isFinite(lat) && lat !== 0 && (
        <MapFrame center={[lat, lon]} zoom={13} className="org-map">
          <InvalidateOnResize />
          <Marker position={[lat, lon]} icon={pinIcon("truck", "ink")} />
        </MapFrame>
      )}
    </section>
  );
}

function Mini({ icon: Icon, tone, label, value, unit, small }: {
  icon: typeof Mail; tone: string; label: string; value: string; unit?: string; small?: boolean;
}) {
  return (
    <div className="mini">
      <span className="mini-icon" data-tone={tone}><Icon size={16} /></span>
      <div style={{ minWidth: 0 }}>
        <div className="stat-label">{label}</div>
        <div className={small ? "mini-value small" : "mini-value num"}>{value}{unit && <small>{unit}</small>}</div>
      </div>
    </div>
  );
}

interface OcemsConnection {
  connection_id: string; stp_id: string; provider: string; provider_label: string; base_url: string; key_hint: string;
  submitted_at: string; status: string; test_ok: boolean; test_message: string; tested_at: string; admin_remark: string;
  reviewed_at: string;
}
interface OcemsConnectionData {
  stp_id: string;
  providers: { id: string; label: string; host_suffix: string }[];
  active: OcemsConnection | null;
}

function OcemsFeedCard() {
  const toast = useToast();
  const c = useAsync((s) => getJSON<OcemsConnectionData>("/api/ocems/connection", s));
  const [open, setOpen] = useState(false);
  const active = c.data?.active ?? null;

  async function disconnect() {
    if (!window.confirm("Disconnect the live OCEMS feed? Your OCEMS page will show no readings until you connect again.")) return;
    try {
      await postJSON("/api/ocems/connection/remove", {});
      toast("Live feed disconnected.", "success");
      c.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not disconnect", "danger");
    }
  }

  return (
    <section className="card">
      <header className="card-head">
        <div><h2>OCEMS live feed</h2><p>Connect your plant's online monitoring system so quality readings update on their own</p></div>
        {c.data && (
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpen(true)}>
            <KeyRound size={15} /> {active ? "Change key" : "Connect"}
          </button>
        )}
      </header>
      <div className="ocems-feed">
        {c.loading && !c.data ? <SkeletonRows rows={2} /> : c.error ? <Notice tone="danger">{c.error}</Notice> : (
          <>
            {active ? (
              <ConnectionRow conn={active} action={
                <button type="button" className="btn btn-sm btn-ghost" onClick={disconnect}><Unplug size={15} /> Disconnect</button>
              } />
            ) : (
              <Empty icon={Wifi} title="No live feed connected">
                Paste the OCEMS data link from your vendor (or the platform URL and API key). ReFlow checks that it
                returns readings and starts using it straight away.
              </Empty>
            )}
          </>
        )}
      </div>
      {open && c.data && (
        <ConnectDialog providers={c.data.providers} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); c.reload(); }} />
      )}
    </section>
  );
}

function ConnectionRow({ conn, action }: { conn: OcemsConnection; action?: React.ReactNode }) {
  return (
    <div className="feed-row">
      <span className="mini-icon" data-tone="teal"><Wifi size={16} /></span>
      <div className="feed-main">
        <div className="row wrap" style={{ gap: 8 }}>
          <strong>Connected</strong>
          <span className="badge" data-tone="success">Live</span>
        </div>
        <div className="feed-meta">
          <span className="num">{conn.base_url.replace("https://", "")}</span> · {conn.provider_label} · {conn.key_hint ? <>key <span className="num">{conn.key_hint}</span></> : "public link"}
        </div>
        <div className="feed-meta">{conn.test_message}</div>
        <div className="feed-meta">Connected {when(conn.submitted_at)}</div>
      </div>
      {action}
    </div>
  );
}

function ConnectDialog({ providers, onClose, onSaved }: {
  providers: OcemsConnectionData["providers"]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [provider, setProvider] = useState(providers[0]?.id ?? "trata");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const suffix = providers.find((x) => x.id === provider)?.host_suffix ?? "";

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await postJSON("/api/ocems/connection", { provider, base_url: baseUrl, api_key: apiKey });
      toast("Connected. Live OCEMS readings are now in use.", "success");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not connect", "danger");
      setSaving(false);
    }
  }

  return (
    <Dialog title="Connect OCEMS live feed" onClose={onClose}>
      <form onSubmit={save} className="stack" autoComplete="off">
        {providers.length > 1 && (
          <label className="field"><span className="field-label">Vendor</span>
            <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {providers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
        )}
        {providers.length === 1 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Vendor: {providers[0].label}</p>}
        <label className="field"><span className="field-label">OCEMS data link or platform URL</span>
          <input className="input" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={`https://yoursite${suffix}/api/data/single?…`} inputMode="url" spellCheck={false} />
          <span className="field-hint">If your link already contains the key, paste it in full and leave the API key empty.</span>
        </label>
        <label className="field"><span className="field-label">API key <span className="muted">(optional)</span></span>
          <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            spellCheck={false} autoComplete="new-password" />
        </label>
        <p className="muted" style={{ margin: 0, fontSize: 12.5, display: "flex", gap: 6 }}>
          <ShieldCheck size={14} style={{ flex: "0 0 14px", marginTop: 2 }} />
          ReFlow checks that the link returns OCEMS data before saving it. The key (or the link holding it) is stored
          encrypted and only its last four characters are ever shown.
        </p>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Checking…" : "Check and connect"}</button>
        </div>
      </form>
    </Dialog>
  );
}
