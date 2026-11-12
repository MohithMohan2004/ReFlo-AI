# ReFlow

**Treated wastewater, routed where it's needed.**

ReFlow connects sewage treatment plants (STPs) in Bengaluru with the people who can reuse their treated water, and coordinates the tankers that carry it there.

Treated water is a valuable resource, yet most of it goes unused. Buyers rarely know which plant is nearby, whether its water meets quality standards, or how to get it delivered. Plants have spare capacity but no simple way to sell it. ReFlow brings both sides, and the delivery partners between them, onto one platform.

## Who it's for

| Role | Who they are | What ReFlow gives them |
|---|---|---|
| **Demand sites** | Construction sites, apartments, industry, landscaping | Find the nearest plant that has the right water, check its live quality readings, order, track the tanker and pay |
| **Plant operators (STPs)** | Treatment plant teams | Receive and accept orders, set prices, publish quality data, see demand forecasts, transfer water to other plants |
| **Tanker partners** | Independent and contracted delivery operators | Get job offers nearby, navigate each trip, share live location, manage their fleet and documents |
| **Admins** | Platform staff | Approve plants, tankers and quality reports, and watch demand across the city |

## How it works

1. **A buyer asks for water.** They set a delivery point (address, current location or a pin on the map), a quantity and a quality grade. ReFlow finds the nearest plant that can supply it and shows the road route, travel time and the plant's latest quality readings.
2. **The plant accepts.** The plant operator reviews the order and accepts or rejects it.
3. **A tanker is assigned.** The job is offered to nearby tanker partners one at a time, each with a short time to respond.
4. **The tanker delivers.** The driver taps **Start trip**. Google Maps opens with directions to the plant, then on to the buyer after pickup. Meanwhile the buyer follows the tanker live.
5. **The buyer pays.** A tax invoice (CGST + SGST) is issued, payable online or as cash on delivery. The trip is added to the tanker's history.

Plants can also request water from each other, using the same tanker assignment flow.

## Features

<sub>Screenshots are from the Android app, with demo account details. They follow your GitHub theme: switch GitHub to dark mode to see ReFlow's dark theme.</sub>

### For demand sites

<table>
<tr>
<td width="50%" align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/demand-find-water-dark.png"><img src="docs/screenshots/demand-find-water.png" width="260" alt="Map of nearby treatment plants with the delivery search form"></picture></td>
<td width="50%">

#### Find treated water

Every plant near you is on the map. Set where the water should go by searching an address, using your current location or dropping a pin. Then pick the quantity (5 KLD minimum), the quality grade and the water type.

</td>
</tr>
<tr>
<td width="50%">

#### See your match

ReFlow picks the nearest plant that can supply the order and draws the road route to your site. The match card shows the distance, the travel time and the plant's latest OCEMS quality readings. Alternative routes are shown when there are any.

</td>
<td width="50%" align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/demand-match-dark.png"><img src="docs/screenshots/demand-match.png" width="260" alt="Matched plant with the road route, distance and travel time"></picture></td>
</tr>
</table>

**Also:**
- Order list with All / Active / Pending / Completed filters, live tracking and shareable tracking links.
- Tax invoices with an order timeline, print/PDF export, and pay-now or cash on delivery.

### For plant operators

<table>
<tr>
<td width="50%" align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/plant-dashboard-dark.png"><img src="docs/screenshots/plant-dashboard.png" width="260" alt="Plant operator dashboard with a map of orders and daily stats"></picture></td>
<td width="50%">

#### Run the plant from one screen

The map shows the plant and the orders it serves. Opening an order draws its delivery route. The sheet below shows the water available today, pending requests, deliveries in progress and tomorrow's demand forecast, followed by the order list and plant-to-plant transfer requests.

</td>
</tr>
</table>

**Also:**
- A 7-day demand forecast.
- Pricing control: base rate, peak-hour surcharge and off-peak discount.
- Quality reporting through OCEMS (online effluent monitoring) uploads, checked against CPCB limits.
- Plant-to-plant water transfers.

### For tanker partners

<table>
<tr>
<td width="50%" align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/tanker-map-dark.png"><img src="docs/screenshots/tanker-map.png" width="260" alt="Tanker partner map with the Start trip button"></picture></td>
<td width="50%">

#### Start a trip

The tanker's position and nearby plants are on the map. **Start trip** turns on live location sharing, so the buyer can follow the delivery, and opens Google Maps with directions to the pickup plant and then the drop-off.

</td>
</tr>
<tr>
<td width="50%">

#### Pick up jobs

Drag the sheet up to see offers waiting, active jobs and completed deliveries. Each job shows the plant, the drop-off, the load, the quality grade and the haul distance. New offers arrive with a countdown and the list refreshes on its own.

</td>
<td width="50%" align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/tanker-jobs-dark.png"><img src="docs/screenshots/tanker-jobs.png" width="260" alt="Job list in the draggable bottom sheet"></picture></td>
</tr>
<tr>
<td width="50%" align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/tanker-trip-history-dark.png"><img src="docs/screenshots/tanker-trip-history.png" width="260" alt="Trip history with totals, a delivery chart and a route map"></picture></td>
<td width="50%">

#### Look back at every trip

Totals for trips, water delivered and distance hauled, a 30-day chart of deliveries and a map of past routes.

</td>
</tr>
</table>

**Also:**
- A **Current job** card showing where to go next, the load, distance and drive time, and a one-tap call to the buyer.
- Fleet and compliance documents (RC, insurance, PUC, permit) for each vehicle.
- Step-by-step registration for independent and contracted operators, with a status lookup.

### For admins
- Overview, plants, approvals and orders in one dashboard.
- A city-wide order-density heat map with plant locations.
- Approval of plant and tanker registrations and OCEMS quality reports.

### Across the platform
- **Juno**, a chat assistant that finds plants and answers questions in plain language.
- **Demand forecasting** with a trained XGBoost model for each plant.
- **Light and dark themes**: follows the device setting, or choose Light or Dark from the profile page or account menu.
- **Android app** with native GPS, an app-style phone layout, a bottom tab bar, a full-screen map and a draggable bottom sheet.

## Android app

The Android app (`mobile/`) is a Capacitor shell around the web app. Pages load from the ReFlow server, so web updates reach the app without a new release. GPS runs through the native location service, so live tracking and "use my location" work reliably on phones. See [`mobile/README.md`](mobile/README.md) to build it.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python, Flask, Gunicorn |
| Authentication | Supabase |
| Storage | PostgreSQL (via SQLAlchemy), with CSV/JSON files as a fallback for local use |
| Web frontend | React 19, TypeScript, Vite, React Router, React-Leaflet, lucide icons |
| Maps and routing | OpenStreetMap, Leaflet, OSRM road routing, OSMnx / NetworkX |
| Forecasting | XGBoost, scikit-learn, pandas, NumPy |
| Assistant | A local LLM through Ollama (`llama3.2:3b`), with RapidFuzz fuzzy matching |
| Mobile | Capacitor 8 (Android) |

## Project structure

```
app.py          Flask application: pages, business logic and JSON APIs
config.py       Settings read from environment variables
store.py        PostgreSQL storage layer
frontend/       React web app (builds into static/app/)
templates/      Server-rendered pages (login, signup, tracking, invoice, admin)
static/         Shared styles, brand assets and the built web app
mobile/         Android app (Capacitor)
ml/             Demand forecasting: dataset, training and prediction
chatbot/        Juno: fuzzy matcher and LLM gateway
data/           Plant master data, pricing and synthetic demand
scripts/        Utility scripts (data migration, synthetic data, routing)
supabase/       SQL migrations for Supabase
```

## Running locally

**Requirements:** Python 3.10+, Node.js 18+ (only to change the web frontend), and a Supabase project. Ollama is optional, for Juno's language model.

```bash
# Backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py                 # http://localhost:10000

# Web frontend (optional, for development)
cd frontend
npm install
npm run dev                   # http://localhost:5173, talks to Flask on :10000
npm run build                 # production build into static/app/
```

The server reads its settings from environment variables (or a `.env` file):

| Variable | Required | Purpose |
|---|---|---|
| `FLASK_SECRET_KEY` | Yes | Signs session cookies |
| `SUPABASE_URL`, `SUPABASE_KEY` | Yes | Supabase project for sign-in |
| `DATABASE_URL` | No | PostgreSQL connection. Without it, the app stores data in local files |
| `DATABASE_SCHEMA` | No | Schema for ReFlow's tables (default `reflow`) |
| `PORT` | No | Server port (default `10000`) |
| `OLLAMA_BASE_URL`, `JUNO_LLM_MODEL`, `JUNO_LLM_TIMEOUT` | No | Juno's language model settings |

To move existing local data into PostgreSQL, run `python scripts/migrate_to_postgres.py` once.

In production the app runs under Gunicorn (`gunicorn app:app --timeout 120`, see `Procfile`).

## Demand forecasting

Each plant has its own XGBoost model, trained on demand data for that plant. It predicts next-day and 7-day demand. Plant operators see the 7-day forecast on their dashboard and can plan capacity around it. Training and prediction code lives in `ml/`.

## Juno, the assistant

Juno is built into the dashboards. It handles everyday requests such as *"find me water near Jayanagar"* and general questions about the platform. Messages are first matched against known intents with fuzzy matching. Unclear messages go to a small local language model, which extracts the intent and any location. Juno keeps working on fuzzy matching alone if the model is unavailable.
