"""
Live OCEMS readings from a plant's monitoring vendor.

Supported provider: Trata (used by Aadhav Intech sites), one host per site,
e.g. https://trtdlaita590.tratasoft.com. Authentication is the
``X-Status-Api-Key`` header. Endpoints (all GET, CSV responses):

    /api/data/single                         latest saved row
    /api/data/monthly                        rolling 30 days
    /api/data/range?from=YYYY-MM-DD&to=...   inclusive range, IST

The CSV holds a timestamp column plus one column per configured parameter
(label and unit). "--" means a missing value, 0 is a real reading, and a
period without data returns HTTP 200 with the header only.

Some sites hand out a ready-made link with the key already inside it
(e.g. https://trtdlaita590.tratasoft.com/api/data/single?key=...). Such a
link is stored as the credential itself (see is_link()) and called as-is,
without the header.

API keys and links are stored encrypted (Fernet). The encryption key comes from
OCEMS_KEY_SECRET, or FLASK_SECRET_KEY when that is not set. Changing that
secret makes stored keys unreadable, so plants would have to resubmit.
"""

import base64
import csv
import hashlib
import io
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlparse

import requests
from cryptography.fernet import Fernet, InvalidToken


IST = timezone(timedelta(hours=5, minutes=30))

PROVIDERS = {
    "trata": {
        "label": "Trata OCEMS (Aadhav Intech)",
        # Only these hosts may be called, so a plant can't point the
        # server at an arbitrary URL.
        "host_suffix": ".tratasoft.com",
        "key_header": "X-Status-Api-Key",
    },
}

# Trata is slow: the latest row takes 5-25 s and a two-day range ~30 s
# (one row per minute), so history is fetched in the background and
# pages are served from the last good copy (see cached_history()).
REQUEST_TIMEOUT = 40          # seconds for the latest-row call
RANGE_TIMEOUT = 150           # seconds for the history call
HISTORY_DAYS = 7              # readings shown on the OCEMS pages
HISTORY_STEP_MINUTES = 15     # keep one row per 15 minutes (+ the newest)
# New readings land every minute, so the latest row is polled every
# minute and merged into the cached history; the slow full range is
# re-downloaded only every HISTORY_TTL to fill gaps.
CACHE_TTL = 60                # poll the latest row every minute
HISTORY_TTL = 1800            # re-download the full history every 30 minutes
ERROR_TTL = 60                # retry a failed call after 1 minute
FIRST_LOAD_WAIT = 20          # seconds a page waits when nothing is cached

_cache = {}                   # key -> {"data", "error", "fresh_until", "history_until", "thread"}
_cache_lock = threading.Lock()


class OcemsApiError(Exception):
    """A vendor call failed; the message is safe to show to users."""


def _log(message):
    print(f"OCEMS feed: {message}", flush=True)


def _with_deadline(fn, seconds):
    """Run fn() with a hard limit on total time. requests' own timeout is
    per socket operation, so DNS lookups or a response that trickles in
    slowly can otherwise block a refresh forever."""
    box = {}

    def run():
        try:
            box["value"] = fn()
        except BaseException as e:  # handed back to the caller
            box["error"] = e

    worker = threading.Thread(target=run, name="ocems-call", daemon=True)
    worker.start()
    worker.join(seconds)
    if worker.is_alive():
        raise requests.Timeout(f"no complete response within {seconds} s")
    if "error" in box:
        raise box["error"]
    return box["value"]


# ---------------------------------------------------------------------------
# Key encryption
# ---------------------------------------------------------------------------

def _fernet():
    secret = (
        os.getenv("OCEMS_KEY_SECRET")
        or os.getenv("FLASK_SECRET_KEY")
        or ""
    ).strip()
    if not secret:
        raise RuntimeError("Set OCEMS_KEY_SECRET (or FLASK_SECRET_KEY) to store OCEMS API keys.")
    digest = hashlib.sha256(("reflow-ocems:" + secret).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_key(api_key):
    return _fernet().encrypt(api_key.encode()).decode()


def decrypt_key(token):
    try:
        return _fernet().decrypt(str(token or "").encode()).decode()
    except (InvalidToken, ValueError):
        raise OcemsApiError("The stored API key can't be read. Ask the plant to submit it again.")


def key_hint(api_key):
    """Masked hint of the key; "" for a data link that carries no key."""
    api_key = str(api_key or "")
    if is_link(api_key):
        values = [v for _, v in parse_qsl(urlparse(api_key).query)]
        if not values:
            return ""
        api_key = max(values, key=len)
    return ("•" * 4 + api_key[-4:]) if len(api_key) > 4 else "•" * 4


def is_link(credential):
    """True when the stored credential is a full data link (key inside)."""
    return str(credential or "").startswith("https://")


# ---------------------------------------------------------------------------
# URL handling
# ---------------------------------------------------------------------------

def normalise_base_url(raw, provider="trata"):
    """Reduce whatever the vendor sent (".../data&single", ".../api/data/single")
    to "https://<host>", and check the host belongs to the provider."""
    spec = PROVIDERS.get(provider)
    if not spec:
        raise OcemsApiError("Unsupported OCEMS provider.")

    raw = str(raw or "").strip()
    if not raw:
        raise OcemsApiError("Enter the platform URL from your OCEMS vendor.")
    if "://" not in raw:
        raw = "https://" + raw

    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()

    if parsed.scheme != "https":
        raise OcemsApiError("The platform URL must start with https://.")
    if not host.endswith(spec["host_suffix"]) or host == spec["host_suffix"].lstrip("."):
        raise OcemsApiError(
            f"The platform URL must be a {spec['host_suffix'].lstrip('.')} address "
            f"(for example https://yoursite{spec['host_suffix']})."
        )
    if parsed.port not in (None, 443):
        raise OcemsApiError("The platform URL can't use a custom port.")

    return f"https://{host}"


def normalise_data_link(raw, provider="trata"):
    """Check a full data link (key inside) and return (base_url, link)."""
    raw = str(raw or "").strip()
    if not raw:
        raise OcemsApiError("Paste the OCEMS data link from your vendor.")
    if "://" not in raw:
        raw = "https://" + raw
    if len(raw) > 2048 or any(c.isspace() for c in raw):
        raise OcemsApiError("Paste the data link exactly as your vendor sent it.")
    base_url = normalise_base_url(raw, provider)
    parsed = urlparse(raw)
    if not parsed.query and parsed.path in ("", "/"):
        raise OcemsApiError(
            "This link has no key in it. Paste the full data link, or enter the API key as well."
        )
    link = base_url + (parsed.path or "/") + (("?" + parsed.query) if parsed.query else "")
    return base_url, link


# ---------------------------------------------------------------------------
# Vendor calls
# ---------------------------------------------------------------------------

def _get_csv(base_url, api_key, path, params=None, provider="trata", timeout=REQUEST_TIMEOUT):
    """GET base_url + path. With a data link as api_key, the link's own
    query (which carries the key) is sent instead of the key header, and
    path=None calls the link exactly as given."""
    spec = PROVIDERS[provider]
    headers = {"Accept": "text/csv"}
    if is_link(api_key):
        link = urlparse(api_key)
        url = base_url + (link.path if path is None else path)
        params = urlencode(parse_qsl(link.query, keep_blank_values=True) + list((params or {}).items()))
    else:
        url = base_url + path
        headers[spec["key_header"]] = api_key
    started = time.monotonic()
    host = urlparse(url).hostname
    try:
        res = _with_deadline(
            lambda: requests.get(
                url,
                params=params,
                headers=headers,
                timeout=(15, timeout),
                allow_redirects=False,
            ),
            timeout + 20,
        )
    except requests.RequestException as e:
        _log(f"{host} {urlparse(url).path} failed after {time.monotonic() - started:.1f} s: "
             f"{type(e).__name__}: {str(e)[:160]}")
        raise OcemsApiError("Could not reach the OCEMS platform. Try again later.")
    _log(f"{host} {urlparse(url).path} -> HTTP {res.status_code}, {len(res.content)} bytes "
         f"in {time.monotonic() - started:.1f} s")

    if res.status_code == 401:
        raise OcemsApiError("The OCEMS platform rejected the API key.")
    if res.status_code == 403:
        message = ""
        try:
            message = str(res.json().get("message") or "")
        except ValueError:
            pass
        raise OcemsApiError(
            message[:200] or "The OCEMS platform refused access for this site."
        )
    if res.status_code != 200:
        raise OcemsApiError(f"The OCEMS platform answered with HTTP {res.status_code}.")

    content_type = res.headers.get("content-type", "")
    if "html" in content_type:
        raise OcemsApiError("The OCEMS platform returned a web page instead of CSV data.")

    return res.text


def test_connection(base_url, api_key, provider="trata"):
    """Fetch the latest row. Returns (ok, message)."""
    try:
        path = None if is_link(api_key) else "/api/data/single"
        text = _get_csv(base_url, api_key, path, provider=provider)
        parsed = parse_csv(text)
    except OcemsApiError as e:
        return False, str(e)

    if not parsed["parameters"]:
        return False, "Connected, but the response had no parameter columns."
    if not parsed["rows"]:
        return True, "Connected. No readings saved yet (" + ", ".join(parsed["parameters"]) + ")."

    latest = parsed["rows"][0]
    return True, f"Connected. Latest reading {latest['timestamp']} ({', '.join(parsed['parameters'])})."


def fetch_latest(base_url, api_key, provider="trata"):
    path = None if is_link(api_key) else "/api/data/single"
    return parse_csv(_get_csv(base_url, api_key, path, provider=provider))


def fetch_history(base_url, api_key, provider="trata", days=HISTORY_DAYS):
    if is_link(api_key):
        # Try the range endpoint with the link's key; if the vendor only
        # allows the link itself, fall back to it (latest reading only).
        try:
            parsed = _fetch_range(base_url, api_key, provider, days)
            if parsed["rows"]:
                return parsed
        except OcemsApiError:
            pass
        return fetch_latest(base_url, api_key, provider)
    return _fetch_range(base_url, api_key, provider, days)


def thin_rows(rows, step=HISTORY_STEP_MINUTES):
    """Keep the newest row plus one row per `step` minutes (newest first)."""
    if not rows:
        return rows
    kept = [rows[0]]
    for row in rows[1:]:
        minute = int(row["timestamp"][14:16] or 0)
        if minute % step == 0:
            kept.append(row)
    return kept


def _fetch_range(base_url, api_key, provider, days):
    today = datetime.now(IST).date()
    text = _get_csv(
        base_url,
        api_key,
        "/api/data/range",
        params={
            "from": (today - timedelta(days=days - 1)).isoformat(),
            "to": today.isoformat(),
        },
        provider=provider,
        timeout=RANGE_TIMEOUT,
    )
    parsed = parse_csv(text)
    parsed["rows"] = thin_rows(parsed["rows"])
    return parsed


def _new_entry():
    return {"data": None, "error": None, "fresh_until": 0, "history_until": 0, "thread": None}


def _store(cache_key, data=None, error=None, ttl=CACHE_TTL, history=False):
    with _cache_lock:
        entry = _cache.setdefault(cache_key, _new_entry())
        if data is not None:
            entry["data"] = data
        entry["error"] = error
        entry["fresh_until"] = time.monotonic() + ttl
        if history:
            entry["history_until"] = time.monotonic() + HISTORY_TTL


def merge_latest(history, latest):
    """Put newer rows from a latest-row response on top of the cached
    history (newest first), keeping the 15-minute thinning."""
    if not history or not history.get("rows"):
        return latest
    newest = history["rows"][0]["timestamp"]
    fresh = [r for r in latest["rows"] if r["timestamp"] > newest]
    if not fresh:
        return history
    return {
        "parameters": latest["parameters"] or history["parameters"],
        "units": {**history.get("units", {}), **latest.get("units", {})},
        "rows": thin_rows(fresh + history["rows"]),
    }


def _refresh(cache_key, base_url, api_key, provider):
    """Background job. Normally one quick latest-row call, merged into the
    cache; the full history only when missing or older than HISTORY_TTL."""
    started = time.monotonic()
    try:
        with _cache_lock:
            entry = _cache.get(cache_key) or {}
            data = entry.get("data")
            need_history = entry.get("history_until", 0) <= time.monotonic()

        if data is None or not need_history:
            try:
                latest = fetch_latest(base_url, api_key, provider)
                if latest["rows"]:
                    data = merge_latest(data, latest)
                    _store(cache_key, data=data, ttl=0 if need_history else CACHE_TTL)
                elif not need_history:
                    _store(cache_key)
            except OcemsApiError as e:
                if not need_history:
                    _store(cache_key, error=e, ttl=ERROR_TTL)

        if need_history:
            try:
                history = fetch_history(base_url, api_key, provider)
                with _cache_lock:
                    current = (_cache.get(cache_key) or {}).get("data")
                # Keep any newer row the latest call found meanwhile.
                _store(cache_key, data=merge_latest(history, current) if current else history, history=True)
            except OcemsApiError as e:
                _store(cache_key, error=e, ttl=ERROR_TTL)
    except Exception as e:  # never leave the cache stuck "loading"
        _log(f"{cache_key} refresh crashed: {type(e).__name__}: {e}")
        _store(cache_key, error=OcemsApiError("Could not load OCEMS readings."), ttl=ERROR_TTL)
    finally:
        with _cache_lock:
            entry = _cache.get(cache_key) or {}
            rows = len((entry.get("data") or {}).get("rows") or [])
            error = entry.get("error")
        _log(f"{cache_key} refresh done in {time.monotonic() - started:.1f} s: "
             f"{rows} rows cached{f', error: {error}' if error else ''}")
        with _cache_lock:
            if cache_key in _cache:
                _cache[cache_key]["thread"] = None


def refresh_async(cache_key, base_url, api_key, provider="trata"):
    """Start a background refresh unless one is already running."""
    with _cache_lock:
        entry = _cache.setdefault(cache_key, _new_entry())
        if entry["thread"] is not None:
            return entry["thread"]
        thread = threading.Thread(
            target=_refresh, args=(cache_key, base_url, api_key, provider),
            name=f"ocems-{cache_key}", daemon=True,
        )
        entry["thread"] = thread
    thread.start()
    return thread


def cached_history(cache_key, base_url, api_key, provider="trata"):
    """Readings for a page view without waiting on the slow vendor:
    returns the last good data (refreshing it in the background when it
    is older than CACHE_TTL). With nothing cached yet it waits up to
    FIRST_LOAD_WAIT seconds. Raises OcemsApiError when there is no data."""
    with _cache_lock:
        entry = _cache.get(cache_key) or {}
        data, error = entry.get("data"), entry.get("error")
        stale = entry.get("fresh_until", 0) <= time.monotonic()

    if stale:
        thread = refresh_async(cache_key, base_url, api_key, provider)
        if data is None:
            deadline = time.monotonic() + FIRST_LOAD_WAIT
            while time.monotonic() < deadline:
                thread.join(0.5)
                with _cache_lock:
                    entry = _cache.get(cache_key) or {}
                    data, error = entry.get("data"), entry.get("error")
                if data is not None or not thread.is_alive():
                    break

    if data is not None:
        return data
    raise error or OcemsApiError("Still loading readings from the OCEMS platform. Refresh in a minute.")


def clear_cache(cache_key=None):
    with _cache_lock:
        if cache_key is None:
            _cache.clear()
        else:
            _cache.pop(cache_key, None)


def start_warmer(list_connections, interval=CACHE_TTL):
    """Daemon thread that refreshes every active feed each `interval`
    seconds, so OCEMS pages rarely have to wait for the vendor.
    list_connections() returns [(cache_key, base_url, api_key, provider)]."""
    def loop():
        while True:
            try:
                for args in list_connections():
                    refresh_async(*args)
            except Exception as e:  # never let the warmer die
                _log(f"warmer error: {type(e).__name__}: {e}")
            time.sleep(interval)
    threading.Thread(target=loop, name="ocems-warmer", daemon=True).start()
    _log(f"warmer started (pid {os.getpid()}, every {interval} s)")


# ---------------------------------------------------------------------------
# CSV parsing
# ---------------------------------------------------------------------------

MISSING = {"", "--", "-", "—", "na", "n/a", "nan", "null", "none"}

# Canonical names used across ReFlow (CPCB limits, the demand match card).
CANONICAL = [
    (re.compile(r"\bph\b", re.I), "pH"),
    (re.compile(r"\bbod\b", re.I), "BOD"),
    (re.compile(r"\bcod\b", re.I), "COD"),
    (re.compile(r"\btss\b|total suspended", re.I), "TSS"),
]

# Units for the CPCB parameters. Trata sites sometimes label every
# column with the flow unit (e.g. "COD (m³/hr)"), so these win.
CANONICAL_UNITS = {"COD": "mg/L", "BOD": "mg/L", "TSS": "mg/L", "pH": ""}

TIME_WORDS = re.compile(r"time|date", re.I)

TIMESTAMP_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M",
    "%d-%m-%Y %H:%M:%S",
    "%d-%m-%Y %H:%M",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
    "%Y-%m-%d",
    "%d-%m-%Y",
    "%d/%m/%Y",
)


def _parse_timestamp(value):
    value = str(value or "").strip()
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        dt = None
        for fmt in TIMESTAMP_FORMATS:
            try:
                dt = datetime.strptime(value, fmt)
                break
            except ValueError:
                continue
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(IST).replace(tzinfo=None)
    return dt


def _split_label(label):
    """"BOD (mg/l)" -> ("BOD (mg/l)", "mg/l")."""
    label = str(label or "").strip()
    m = re.search(r"[\(\[]\s*([^\)\]]*)\s*[\)\]]\s*$", label)
    unit = m.group(1).strip() if m else ""
    return label, unit


def _canonical(label):
    base = re.sub(r"[\(\[].*$", "", label).strip()
    for pattern, name in CANONICAL:
        if pattern.search(base):
            return name
    return base or label


def _number(value):
    text = str(value or "").strip()
    if text.lower() in MISSING:
        return None
    try:
        n = float(text.replace(",", ""))
    except ValueError:
        return text
    return int(n) if n.is_integer() else round(n, 3)


def parse_csv(text):
    """Turn the vendor CSV into {"parameters", "units", "rows"}; rows are
    newest first with "YYYY-MM-DD HH:MM:SS" IST timestamps."""
    text = str(text or "").lstrip("﻿")
    table = [
        [c.strip() for c in row]
        for row in csv.reader(io.StringIO(text))
        if any(c.strip() for c in row)
    ]
    if not table:
        return {"parameters": [], "units": {}, "rows": []}

    # Header: the first row naming a time/date column (else row 0).
    header_index = next(
        (i for i, row in enumerate(table[:10]) if any(TIME_WORDS.search(c) for c in row)),
        0,
    )
    header = table[header_index]

    time_cols = [i for i, c in enumerate(header) if TIME_WORDS.search(c)]
    if not time_cols:
        time_cols = [0]
    # A separate "Date" + "Time" pair is joined; otherwise use the first.
    date_col = next((i for i in time_cols if re.search(r"date", header[i], re.I)), None)
    clock_col = next((i for i in time_cols if re.fullmatch(r"\s*time\s*", header[i], re.I)), None)
    join_cols = [date_col, clock_col] if date_col is not None and clock_col is not None else [time_cols[0]]

    skip = set(time_cols) | {
        i for i, c in enumerate(header)
        if re.fullmatch(r"(s\.?\s*no\.?|sl\.?\s*no\.?|#|status|station.*|site.*)", c, re.I)
    }

    columns = []   # (index, canonical name)
    units = {}
    seen = set()
    for i, cell in enumerate(header):
        if i in skip or not cell:
            continue
        label, unit = _split_label(cell)
        name = _canonical(label)
        if name in seen:
            name = label
        seen.add(name)
        columns.append((i, name))
        if unit:
            units[name] = unit

    rows = []
    for row in table[header_index + 1:]:
        stamp = " ".join(row[i] for i in join_cols if i < len(row)).strip()
        dt = _parse_timestamp(stamp)
        if dt is None:
            # A units row such as "Unit, pH, mg/l, ..." under the header.
            for i, name in columns:
                if i < len(row) and row[i] and name not in units and _number(row[i]) == row[i]:
                    units[name] = row[i]
            continue
        entry = {"timestamp": dt.strftime("%Y-%m-%d %H:%M:%S")}
        for i, name in columns:
            entry[name] = _number(row[i]) if i < len(row) else None
        rows.append(entry)

    rows.sort(key=lambda r: r["timestamp"], reverse=True)

    for name, unit in CANONICAL_UNITS.items():
        if any(n == name for _, n in columns):
            if unit:
                units[name] = unit
            else:
                units.pop(name, None)

    return {
        "parameters": [name for _, name in columns],
        "units": units,
        "rows": rows,
    }
