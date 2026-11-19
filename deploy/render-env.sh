#!/usr/bin/env bash
# deploy/render-env.sh: copy the app's settings from Render into .env.azure.
#
#   bash deploy/render-env.sh               # service name from deploy/azure-deploy.conf
#   bash deploy/render-env.sh <service>     # another Render service name
#
# Asks for a Render API key (Render dashboard > Account Settings > API Keys);
# it is read without echo and only sent to api.render.com. RENDER_API_KEY in
# the shell is used instead if set.
#
# Reads, lowest priority first (the same order the app sees them on Render):
#   1. a secret file named ".env" (the app loads it with python-dotenv),
#   2. environment groups linked to the service,
#   3. the service's own environment variables.
# Writes .env.azure (mode 600, never committed) with every name suffixed
# _<project> (FLASK_SECRET_KEY -> FLASK_SECRET_KEY_reflow), backs up an
# existing file to .env.azure.bak, and never prints a value.
# Leaves out PORT, Render-only settings, web build settings, one-time admin
# passwords and empty or multi-line values, and lists what it left out.
# At the end it lists the required settings that are still missing.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

need curl
need jq
APP="$(conf_get APP_NAME)"
[ -n "$APP" ] || die "APP_NAME is missing in $CONF_REL"
PROJECT="$(printf '%s' "$APP" | tr '-' '_')"
SERVICE="${1:-$(conf_get RENDER_SERVICE_NAME)}"
[ -n "$SERVICE" ] || die "give the Render service name: bash deploy/render-env.sh <service>"
API="https://api.render.com/v1"
OUT="$REPO_DIR/.env.azure"

# Settings the code needs, and where to get each one if Render doesn't have it.
REQUIRED="FLASK_SECRET_KEY|the value Render uses (keep it the SAME: it signs logins and encrypts saved OCEMS API keys). Only for a brand-new setup: python3 -c 'import secrets; print(secrets.token_hex(32))'
SUPABASE_URL|Supabase dashboard -> your project -> Project Settings -> Data API -> Project URL (https://<ref>.supabase.co)
SUPABASE_KEY|the same Supabase key Render uses (Supabase -> Project Settings -> API Keys)
DATABASE_URL|Supabase -> your project -> Connect -> Session pooler -> URI (put in the database password)"

if [ -z "${RENDER_API_KEY:-}" ]; then
  printf 'Render API key (input hidden): ' >&2
  read -rs RENDER_API_KEY
  printf '\n' >&2
fi
[ -n "$RENDER_API_KEY" ] || die "no API key given"

BODY="$(mktemp "${TMPDIR:-/tmp}/render.XXXXXX")"
trap 'rm -f "$BODY" "$ERR_FILE" "${TMP_OUT:-}"' EXIT

# render_get PATH_AND_QUERY [object]: GET from the Render API into $BODY and
# check it is a JSON list (or an object with "object"). The key goes to curl
# on stdin, so it never appears in the process list.
render_get() {
  local code want="${2:-array}"
  code="$(printf 'header = "Authorization: Bearer %s"\n' "$RENDER_API_KEY" \
    | curl -sS -K - -H 'Accept: application/json' -o "$BODY" -w '%{http_code}' --max-time 30 "$API$1" 2>"$ERR_FILE")" \
    || die "could not reach $API ($(cat "$ERR_FILE"))"
  if ! jq -e --arg t "$want" 'type == $t' "$BODY" >/dev/null 2>&1 || [ "${code:-0}" -ge 400 ]; then
    if jq -e '.message' "$BODY" >/dev/null 2>&1; then
      die "Render answered $code: $(jq -r '.message' "$BODY")"
    fi
    die "Render answered $code with something that isn't a JSON $want: $(head -c 300 "$BODY" | tr '\n' ' ')"
  fi
}

urlenc() { jq -rn --arg v "$1" '$v | @uri'; }

# render_list PATH UNWRAP: every item of a paged list ("?limit=100&cursor=..."),
# each unwrapped with jq expression UNWRAP, as one JSON array.
render_list() {
  local path="$1" unwrap="$2" all="[]" cursor="" pages=0 q n sep
  case "$path" in *\?*) sep='&' ;; *) sep='?' ;; esac
  while :; do
    q="$path${sep}limit=100"
    [ -n "$cursor" ] && q="$q&cursor=$(urlenc "$cursor")"
    render_get "$q"
    n="$(jq 'length' "$BODY")"
    [ "$n" -gt 0 ] || break
    all="$(jq -c --argjson all "$all" "\$all + [.[] | $unwrap]" "$BODY")"
    cursor="$(jq -r '.[-1].cursor // empty' "$BODY")"
    pages=$((pages + 1))
    [ -n "$cursor" ] || break
    [ "$pages" -lt 100 ] || die "more than 100 pages from $path; something is wrong"
  done
  printf '%s' "$all"
}

say "Finding Render service '$SERVICE'"
render_get "/services?name=$(urlenc "$SERVICE")&limit=20"
ids="$(jq -r --arg n "$SERVICE" '[.[] | .service // . | select(.name == $n) | .id] | unique | .[]' "$BODY")"
count="$(printf '%s' "$ids" | grep -c . || true)"
if [ "$count" != 1 ]; then
  if [ "$count" = 0 ]; then warn "no Render service is named '$SERVICE'."; else warn "$count services are named '$SERVICE'."; fi
  render_get "/services?limit=100"
  say "Services this API key can see (name, type, address):"
  jq -r '.[] | .service // . | "    \(.name)  \(.type // "?")  \(.serviceDetails.url // "")  id=\(.id)"' "$BODY"
  die "run again with the right name: bash deploy/render-env.sh <name>"
fi
SERVICE_ID="$ids"
info "found $SERVICE_ID"

# ALL: [{key, value, from}], lowest priority first; the last one of a key wins.
ALL="[]"
NOTES=""

say "Reading its secret files"
files="$(render_list "/services/$SERVICE_ID/secret-files" '.secretFile // .')"
nfiles="$(printf '%s' "$files" | jq 'length')"
info "$nfiles secret file(s)$( [ "$nfiles" = 0 ] || printf ': %s' "$(printf '%s' "$files" | jq -r '[.[].name] | join(", ")')")"
dotenv="$(printf '%s' "$files" | jq -r '[.[] | select(.name == ".env")][0].content // empty'; printf x)"; dotenv="${dotenv%x}"
if [ -n "$dotenv" ]; then
  # KEY=value lines (optional "export ", quotes, comments), like python-dotenv.
  ALL="$(printf '%s' "$dotenv" | jq -Rsc '
    [split("\n")[] | sub("\r$"; "") | select(test("^\\s*(export\\s+)?[A-Za-z_][A-Za-z0-9_]*\\s*="))
     | sub("^\\s*(export\\s+)?"; "") | capture("^(?<key>[A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(?<value>.*)$")
     | .value |= (sub("\\s+$"; "") | if test("^\".*\"$") or test("^'"'"'.*'"'"'$") then .[1:-1] else sub("\\s+#.*$"; "") end)
     | . + {from: "secret file .env"}]')"
  info "read $(printf '%s' "$ALL" | jq 'length') settings from secret file .env"
fi
other_files="$(printf '%s' "$files" | jq -r '[.[] | select(.name != ".env") | .name] | join(", ")')"
[ -z "$other_files" ] || NOTES="${NOTES}Render secret files not imported (not settings the app reads as env vars): $other_files"$'\n'

say "Reading environment groups linked to it"
groups="$(render_list "/env-groups" '.envGroup // .')"
linked="$(printf '%s' "$groups" | jq -c --arg id "$SERVICE_ID" '[.[] | select([.serviceLinks[]?.id] | index($id))]')"
nlinked="$(printf '%s' "$linked" | jq 'length')"
info "$nlinked linked group(s)$( [ "$nlinked" = 0 ] || printf ': %s' "$(printf '%s' "$linked" | jq -r '[.[].name] | join(", ")')")"
for gid in $(printf '%s' "$linked" | jq -r '.[].id'); do
  render_get "/env-groups/$(urlenc "$gid")" object
  gname="$(jq -r '.name // "?"' "$BODY")"
  if jq -e 'has("envVars")' "$BODY" >/dev/null; then
    ALL="$(jq -c --argjson all "$ALL" --arg g "$gname" '$all + [.envVars[] | {key, value, from: ("group " + $g)}]' "$BODY")"
    info "group $gname: $(jq '.envVars | length' "$BODY") settings"
  else
    warn "your API key can't read the values of environment group '$gname'; add its settings to .env.azure by hand"
  fi
done

say "Reading the service's own environment variables"
svc="$(render_list "/services/$SERVICE_ID/env-vars" '.envVar // . | {key, value, from: "service"}')"
info "$(printf '%s' "$svc" | jq 'length') variables on the service"
ALL="$(jq -cn --argjson a "$ALL" --argjson b "$svc" '$a + $b')"

# Which ones to leave out, and why (printed; values never are).
reason_for() {
  local k="$1" v="$2"
  case "$k" in
    PORT) echo "PORT is always 8080 on Azure"; return ;;
    RENDER|RENDER_*|IS_PULL_REQUEST) echo "Render-only"; return ;;
    PYTHON_VERSION|NODE_VERSION|POETRY_VERSION|BUN_VERSION|GO_VERSION|RUBY_VERSION|ELIXIR_VERSION|PIP_*|PYTHONUNBUFFERED|PYTHONDONTWRITEBYTECODE)
      echo "Render build/runtime setting (the image sets its own)"; return ;;
    WEB_CONCURRENCY|GUNICORN_CMD_ARGS|GUNICORN_*)
      echo "gunicorn tuning for Render (the Azure image runs 1 worker x 8 threads)"; return ;;
    VITE_*|NPM_REGISTRY)
      echo "web build setting (the Azure image builds the web app itself)"; return ;;
    *ADMIN*PASSWORD*|*INITIAL*PASSWORD*|*BOOTSTRAP*|*SEED*PASSWORD*|*DEFAULT*PASSWORD*)
      echo "one-time admin password"; return ;;
  esac
  [ -n "$v" ] || { echo "empty"; return; }
  case "$v" in *$'\n'*|*$'\r'*) echo "multi-line value (add it in the Azure portal)"; return ;; esac
  printf '%s' "$k" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$' || { echo "not a valid name"; return; }
  echo ""
}

say "Writing .env.azure (names end in _$PROJECT)"
# Last occurrence of each key wins (service > linked groups > .env file).
FINAL="$(printf '%s' "$ALL" | jq -c 'reduce .[] as $e ({order: [], m: {}};
  (if .m[$e.key] then . else .order += [$e.key] end) | .m[$e.key] = $e) | [.order[] as $k | .m[$k]]')"
TMP_OUT="$(mktemp "$REPO_DIR/.env.azure.tmp.XXXXXX")"
chmod 600 "$TMP_OUT"
{
  echo "# Settings for Azure app $APP, imported from Render service $SERVICE on $(date -u +%Y-%m-%d)."
  echo "# NEVER commit this file. Every name ends in _$PROJECT; deploy/azure.sh stores"
  echo "# KEY_$PROJECT as the app secret <key>-$APP and gives the app the env var KEY."
  echo "# Edit, then rerun: bash deploy/azure.sh"
} > "$TMP_OUT"
written=0
WRITTEN_KEYS=" "
LEFT_OUT=""
n="$(printf '%s' "$FINAL" | jq 'length')"
i=0
while [ "$i" -lt "$n" ]; do
  k="$(printf '%s' "$FINAL" | jq -r --argjson i "$i" '.[$i].key // ""')"
  from="$(printf '%s' "$FINAL" | jq -r --argjson i "$i" '.[$i].from // ""')"
  v="$(printf '%s' "$FINAL" | jq -r --argjson i "$i" '.[$i].value // ""'; printf x)"; v="${v%x}"; v="${v%$'\n'}"
  i=$((i + 1))
  r="$(reason_for "$k" "$v")"
  if [ -n "$r" ]; then LEFT_OUT="$LEFT_OUT    $k: $r"$'\n'; continue; fi
  printf '%s_%s=%s\n' "$k" "$PROJECT" "$v" >> "$TMP_OUT"
  info "$k -> ${k}_$PROJECT   (from $from)"
  written=$((written + 1))
  WRITTEN_KEYS="$WRITTEN_KEYS$k "
done

if [ -f "$OUT" ]; then
  cp -p "$OUT" "$OUT.bak"
  chmod 600 "$OUT.bak"
  info "previous file kept as .env.azure.bak"
fi
mv "$TMP_OUT" "$OUT"
chmod 600 "$OUT"
TMP_OUT=""

say "Wrote $written settings to .env.azure (mode 600)"
if [ -n "$LEFT_OUT" ]; then
  say "Left out:"
  printf '%s' "$LEFT_OUT"
fi
[ -z "$NOTES" ] || { printf '\n'; printf '%s' "$NOTES" | sed 's/^/    /'; }

MISSING=""
found_required=0
while IFS='|' read -r key where; do
  [ -n "$key" ] || continue
  case "$WRITTEN_KEYS" in
    *" $key "*) found_required=$((found_required + 1)) ;;
    *) MISSING="$MISSING    ${key}_$PROJECT: $where"$'\n' ;;
  esac
done <<EOF
$REQUIRED
EOF

if [ -n "$MISSING" ]; then
  say "Required settings still missing (add each as a line NAME=value in .env.azure):"
  printf '%s' "$MISSING"
fi
if [ "$found_required" = 0 ]; then
  printf '\n' >&2
  warn "NONE of the settings ReFlow needs were found on Render service '$SERVICE'."
  cat >&2 <<EOF
    Render may keep them somewhere this API key can't read. Look in the Render
    dashboard -> service '$SERVICE' -> Environment:
      - "Linked Environment Groups": open each group and copy its values,
      - "Secret Files": open each file and copy the KEY=value lines.
    Then add them to .env.azure by hand (nano .env.azure), one per line, with
    _$PROJECT after the name, e.g. FLASK_SECRET_KEY_$PROJECT=the-value
    (also check that '$SERVICE' is the right service).
EOF
fi
info "Next: check it with 'nano .env.azure', then run: DRY_RUN=1 bash deploy/azure.sh"
