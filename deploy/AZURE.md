# Deploying ReFlow to Azure

ReFlow runs on Azure Container Apps as **one container**: the Flask server (gunicorn), which also
serves the React web app from the same address. After setup, **every push to `main` deploys
automatically** through GitHub Actions (`.github/workflows/azure.yml`).

You run everything below in **Azure Cloud Shell (Bash)**: open portal.azure.com, then click the `>_`
icon at the top. Cloud Shell already has `az`, `git`, `gh` and `jq`. You don't need Docker: GitHub
builds the image.

Every name comes from `deploy/azure-deploy.conf`. The project (app) name is **`reflow`**. The GitHub
repository is still called `ReFlow-AI`; that name is not used for anything in Azure.

| What | Name |
|---|---|
| Resource group (only this project) | `reflow` |
| Container registry (Basic) | `reflow82aaf9d4` |
| Container app | `reflow`, inside the shared environment `purva-bot-env` |
| Deploy identity for GitHub | `reflow-github` (in `reflow`) |
| Image | `reflow82aaf9d4.azurecr.io/reflow:<commit>-<attempt>` |
| Website | none separate: the web app is inside the container |

## Before you start

**1. Your Azure account must be Owner of the subscription** (or Contributor **plus** User Access
Administrator). Contributor alone can create everything but can't grant roles, and both scripts grant
roles: you would get `AuthorizationFailed` on `Microsoft.Authorization/roleAssignments/write`.

Check what you have (in Cloud Shell):

```bash
az role assignment list --assignee "$(az ad signed-in-user show --query id -o tsv)" --all -o table
```

You need a line with `Owner`, or both `Contributor` and `User Access Administrator`, whose scope is
`/subscriptions/82aaf9d4-d161-4dab-8ecf-dff34de35353`. If not, the subscription's Owner adds it:
Azure portal → **Subscriptions** → the subscription → **Access control (IAM)** → **Add** → **Add role
assignment** → pick the role → **Members**: you → **Review + assign**.

A role that was just added can take a few minutes to work. Wait a few minutes, or run `az login` in
the same Cloud Shell tab. Don't close the tab to "restart".

**2. Keep the Cloud Shell tab open until you are done.** If the session ends, files that are not
committed (like `.env.azure`) can be lost, and you would have to repeat step 3.

**3. The workflow files must already be on `main`** (they are pushed before these steps). Check with
`ls deploy` after cloning: you should see `azure.sh`, `github-setup.sh` and `lib.sh`.

## Steps (in order)

### 1. Get the code

```bash
gh auth login
```

Choose GitHub.com, HTTPS, "Yes" to authenticate Git, and "Login with a web browser". Then:

```bash
gh repo clone MohithMohan2004/ReFlow-AI
```

```bash
cd ReFlow-AI
```

The folder has the **repository** name (`ReFlow-AI`), not the project name.

**Already cloned earlier?** Don't clone again. Go into the folder and update it instead:

```bash
cd ReFlow-AI
```

```bash
git checkout main && git pull
```

Then check that the deploy files are there:

```bash
ls deploy
```

If you run several projects in Cloud Shell, keep each one in its own folder and always `cd` into the
right one first. The scripts only read this folder's `deploy/azure-deploy.conf` and `.env.azure`, so
settings left over from another project (an exported `APP_NAME`, another `.env.azure`) can't leak in.

### 2. Set your git name and email (once per Cloud Shell)

Cloud Shell has no git identity, so `git commit` would fail. This repository is **public**, so the
email in a commit is public too. These two commands use your GitHub "noreply" address instead of your
real email:

```bash
git config user.name "$(gh api user --jq '.name // .login')"
```

```bash
git config user.email "$(gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"')"
```

### 3. Create `.env.azure` (the settings)

The secrets live only in `.env.azure`, which git ignores. Create it in the repository folder:

```bash
nano .env.azure
```

Add one line per setting, `NAME_reflow=value` (no quotes, no spaces around `=`). The four required
ones:

```
FLASK_SECRET_KEY_reflow=...
SUPABASE_URL_reflow=https://<ref>.supabase.co
SUPABASE_KEY_reflow=...
DATABASE_URL_reflow=postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

Where to get each one is in the table under [Settings](#settings). Keep `FLASK_SECRET_KEY` the
**same value** the app has always used: it signs logins and encrypts the OCEMS API keys plants have
saved. Only for a brand-new setup, make one with
`python3 -c 'import secrets; print(secrets.token_hex(32))'`.

In nano: move with the arrow keys; paste with right-click → Paste or Ctrl+Shift+V; save with
**Ctrl+O** then **Enter**; quit with **Ctrl+X**. Then lock the file down:

```bash
chmod 600 .env.azure
```

To see only the names (no values): `cut -d= -f1 .env.azure`. **Never commit this file.**

### 4. Create the Azure resources

First see what it would do (nothing is changed; secret values are masked):

```bash
DRY_RUN=1 bash deploy/azure.sh
```

It prints which Azure account and subscription it uses, and warns about required settings that are
missing. Then do it:

```bash
bash deploy/azure.sh
```

This takes a few minutes. Rerunning it is always safe: it only changes what differs.

- **InternalServerError:** just run it again. Azure sometimes reports that error even when the step
  worked; the script checks before it retries.
- **AuthorizationFailed:** your account isn't allowed to grant a role (see "Before you start"). If
  the role was added minutes ago, the script keeps retrying for a while; if it still fails, wait a
  few minutes (or `az login`) and run it again. It continues where it stopped.

At first the app shows a placeholder page (nginx). The first GitHub deploy replaces it.

### 5. Let GitHub deploy

```bash
bash deploy/github-setup.sh
```

It creates the deploy identity `reflow-github`, trusts GitHub runs on `main` of this repository, and
gives it exactly three roles. At the end it prints one `git` line.

### 6. Publish the config file (this starts the first deploy)

Run the line that `github-setup.sh` printed. It looks like this:

```bash
git add deploy/azure-deploy.conf && git commit -m "Azure: deploy identity for GitHub Actions" && git push
```

Run it once. If git asks for a password, run `gh auth setup-git` once, then repeat the line.

If the push is **rejected because `main` is protected**, push it to a branch and open a pull request
instead, then ask someone with write access to approve and merge it:

```bash
git push origin HEAD:azure-config
```

```bash
gh pr create --head azure-config --base main --title "Azure: deploy settings" --body "Values written by deploy/azure.sh and deploy/github-setup.sh"
```

### 7. Watch the deploy, then open the app

```bash
gh run watch
```

Or open the repository's **Actions** tab → "Deploy to Azure". It builds the image (about 5–8
minutes), rolls it out, and waits until the new version is ready and answers on `/health`.

The address is the `BACKEND_URL` line in `deploy/azure-deploy.conf`:

```bash
grep BACKEND_URL deploy/azure-deploy.conf
```

It is `https://reflow.lemonfield-c4c1d145.centralindia.azurecontainerapps.io`. Open it in a browser:
you should see the ReFlow web app, and `/login` should show the sign-in page. The health check is
`/health`: it answers 200 when the app is up and the database answers, 503 if the database can't be
reached.

Until steps 4–6 are done, the workflow finishes with a notice "Azure isn't set up yet" and does
nothing. That is expected.

## Settings

Each setting carries the project name, so it can't clash with another project's:

| In `.env.azure` | Secret in the portal (app → Settings → Secrets) | Env var the code reads | Needed? |
|---|---|---|---|
| `FLASK_SECRET_KEY_reflow` | `flask-secret-key-reflow` | `FLASK_SECRET_KEY` | **Required**: the app doesn't start without it. Keep the value the app has always used: it signs logins and (unless `OCEMS_KEY_SECRET` is set) encrypts saved OCEMS API keys |
| `SUPABASE_URL_reflow` | `supabase-url-reflow` | `SUPABASE_URL` | **Required**: the app doesn't start without it |
| `SUPABASE_KEY_reflow` | `supabase-key-reflow` | `SUPABASE_KEY` | **Required**: the app doesn't start without it |
| `DATABASE_URL_reflow` | `database-url-reflow` | `DATABASE_URL` | **Required on Azure**: Supabase → Connect → **Session pooler** URI. Without it all data is kept in files inside the container and lost on every deploy |
| `DATABASE_SCHEMA_reflow` | `database-schema-reflow` | `DATABASE_SCHEMA` | Optional (default `reflow`) |
| `OCEMS_KEY_SECRET_reflow` | `ocems-key-secret-reflow` | `OCEMS_KEY_SECRET` | Optional. If it was set before, keep the same value, or saved OCEMS API keys stop working |
| `OLLAMA_BASE_URL_reflow`, `JUNO_LLM_MODEL_reflow`, `JUNO_LLM_TIMEOUT_reflow` | `ollama-base-url-reflow`, ... | `OLLAMA_BASE_URL`, ... | Optional: Juno's language model. There is no Ollama in Azure; without one Juno uses its fuzzy matching only |
| (none) | (none) | `PORT=8080` | Always set by the script |

The rule: a line `KEY_reflow=value` in `.env.azure` becomes the secret `<key in lower case, _ → ->-reflow`
and the env var `KEY=secretref:<that secret>`. `azure.sh` refuses any line in `.env.azure` that
doesn't end in `_reflow` (this catches a file copied from another project), and refuses two names
that would become the same secret.

## Changing a setting later

- **In the portal:** container app `reflow` → Settings → **Secrets** → edit the value → Save. Then
  **Revisions and replicas** → restart the active revision so the app reads it.
- **Or in Cloud Shell:** edit `.env.azure` (`nano .env.azure`) and run `bash deploy/azure.sh` again.
  It updates only what changed, starts a new revision, and removes secrets you deleted from the file.
  (If `.env.azure` is gone because the Cloud Shell session ended, recreate it as in step 3.)
- **Size or replicas:** edit `CPU`, `MEMORY`, `MIN_REPLICAS` or `MAX_REPLICAS` in
  `deploy/azure-deploy.conf`, run `bash deploy/azure.sh`, then run the `git` line it prints.

Code changes need nothing: push to `main` and GitHub deploys them. Deploys never change settings.

## What is shared with other projects

- **Shared:** the Container Apps environment `purva-bot-env` (resource group `purva-bot`). The free
  trial allows only one environment in the whole subscription, so every project's app runs in it.
  - This app's logs go to that environment's log workspace (in `purva-bot`).
  - **If that environment is deleted, this app is deleted with it.**
  - The scripts only read it. They never create, change or delete it, or anything else in `purva-bot`.
- **Shared:** one custom role, "Container Apps environment join (purva-bot-env)". It only allows
  reading the environment and placing apps in it, and can only be assigned on that environment. The
  script reuses it.
- **Everything else is this project's own:** resource group, registry, app, identity and secrets.
  The deploy identity can change only group `reflow`, push to its own registry, and join the
  environment. Nothing on `purva-bot`, nothing on the subscription.

## The address

ReFlow is served at **https://reflow.lemonfield-c4c1d145.centralindia.azurecontainerapps.io** (`BACKEND_URL` in `deploy/azure-deploy.conf`).

- **Android app:** `mobile/capacitor.config.ts` and `mobile/www/offline.html` default to this
  address, so `npm run apk` in `mobile/` builds an app that opens it (see `mobile/README.md`).
- **Supabase Auth URLs:** Supabase dashboard → Authentication → URL Configuration. **Site URL** and
  **Redirect URLs** must contain this address (sign-up confirmation and password emails link to the
  Site URL).
- ReFlow prints no QR codes and has no CORS setting (web app and server share one address).

## Removing ReFlow from Azure

```bash
az group delete --name reflow --subscription 82aaf9d4-d161-4dab-8ecf-dff34de35353
```

This removes the app, registry and identity. **Never delete `purva-bot-env`, the `purva-bot` group,
or the "Container Apps environment join (purva-bot-env)" role: other projects use them.**

## Things to know

- **Set `DATABASE_URL`.** Without it, orders, plants, registrations and pricing are written to files
  inside the container and are lost whenever the app restarts or a new version deploys.
- **Tanker vehicle documents** (RC, insurance, PUC, permit uploads) are always saved on the
  container's disk (`uploads/tanker_documents`), even with a database. They are **lost on every
  deploy or restart** (the database keeps the record, but the file is gone). Moving them to Supabase
  Storage or Azure Blob Storage fixes this.
- **Size:** 0.5 vCPU / 1 GiB. Measured locally: about 290 MiB idle and 445 MiB with 8 users
  loading forecasts, dashboards and chat at once. At 0.25 vCPU / 0.5 GiB memory reached 86% of the
  limit and a plant's forecast took about 20 s under that load, so the smaller size is too tight.
  Always on (`MIN_REPLICAS=1`), exactly one replica (`MAX_REPLICAS=1`):
  the app keeps locks, the OCEMS cache and export jobs in memory and uploads on disk, so a second
  copy would disagree with the first.
- **Tanker offer timeouts:** the worker that expires tanker offers after 10/30 minutes starts in
  every gunicorn worker process; a file lock lets only one of them process offers at a time.
- **Caching:** the hashed files under `/static/app/assets/` are cached for a year (their names change
  whenever their content does); everything else is sent with `Cache-Control: no-cache`. Missing
  files under `/static/app/assets/` correctly return 404.
