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

API keys are stored encrypted (Fernet). The encryption key comes from
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
from urllib.parse import urlparse

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

REQUEST_TIMEOUT = 12          # seconds per vendor call
HISTORY_DAYS = 7              # readings shown on the OCEMS pages
CACHE_TTL = 300               # cache good responses for 5 minutes
ERROR_TTL = 60                # and failures for 1 minute

_cache = {}
_cache_lock = threading.Lock()


class OcemsApiError(Exception):
    """A vendor call failed; the message is safe to show to users."""


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
    api_key = str(api_key or "")
    return ("•" * 4 + api_key[-4:]) if len(api_key) > 4 else "•" * 4


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


# ---------------------------------------------------------------------------
# Vendor calls
# ---------------------------------------------------------------------------

def _get_csv(base_url, api_key, path, params=None, provider="trata"):
    spec = PROVIDERS[provider]
    try:
        res = requests.get(
            base_url + path,
            params=params,
            headers={spec["key_header"]: api_key, "Accept": "text/csv"},
            timeout=REQUEST_TIMEOUT,
            allow_redirects=False,
        )
    except requests.RequestException:
        raise OcemsApiError("Could not reach the OCEMS platform. Try again later.")

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
        text = _get_csv(base_url, api_key, "/api/data/single", provider=provider)
        parsed = parse_csv(text)
    except OcemsApiError as e:
        return False, str(e)

    if not parsed["parameters"]:
        return False, "Connected, but the response had no parameter columns."
    if not parsed["rows"]:
        return True, "Connected. No readings saved yet (" + ", ".join(parsed["parameters"]) + ")."

    latest = parsed["rows"][0]
    return True, f"Connected. Latest reading {latest['timestamp']} ({', '.join(parsed['parameters'])})."


def fetch_history(base_url, api_key, provider="trata", days=HISTORY_DAYS):
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
    )
    return parse_csv(text)


def cached_history(cache_key, base_url, api_key, provider="trata"):
    """fetch_history() with a short in-process cache, so page views don't
    each call the vendor. Raises OcemsApiError (also cached briefly)."""
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(cache_key)
        if hit and hit[0] > now:
            if isinstance(hit[1], OcemsApiError):
                raise hit[1]
            return hit[1]

    try:
        result = fetch_history(base_url, api_key, provider)
        entry = (now + CACHE_TTL, result)
    except OcemsApiError as e:
        entry = (now + ERROR_TTL, e)

    with _cache_lock:
        _cache[cache_key] = entry

    if isinstance(entry[1], OcemsApiError):
        raise entry[1]
    return entry[1]


def clear_cache(cache_key=None):
    with _cache_lock:
        if cache_key is None:
            _cache.clear()
        else:
            _cache.pop(cache_key, None)


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

    return {
        "parameters": [name for _, name in columns],
        "units": units,
        "rows": rows,
    }
