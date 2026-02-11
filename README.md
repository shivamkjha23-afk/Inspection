# ATR 2026 Inspection Tracker (PATA Plant)

A full multi-page inspection tracking website with Python backend and shared SQLite database.

## Pages

- `index.html` (Inspection List)
  - filter by final status / equipment type
  - row checkbox selection and bulk update on selected records
  - export selected records CSV
  - export filtered records CSV
  - admin bulk upload + template download
- `form.html` (Add/Edit)
  - all requested dropdowns loaded from backend
  - create/update by ID
  - mark completed auto-fills status + dates
  - auto-populate remarks logic button
- `dashboard.html` (Management)
  - KPI cards
  - click KPI to filter
  - status donut chart and equipment bar chart
  - unit summary table with click-to-filter drill-down

## Roles

- **EIS User**: create/update records
- **Admin**: user actions + delete + bulk CSV upload
- **Management**: view-only (backend enforced)

## Run

```bash
python3 server.py
```

Open:
- `http://localhost:8000/index.html`
- `http://localhost:8000/form.html`
- `http://localhost:8000/dashboard.html`

## API highlights

- `GET /api/options`
- `GET /api/records`
- `GET /api/records/:id`
- `POST /api/records?role=user|admin`
- `PUT /api/records/:id?role=user|admin`
- `DELETE /api/records/:id?role=admin`
- `POST /api/records/bulk-status?role=user|admin`
- `POST /api/records/bulk-upload?role=admin&user=<name>`
- `GET /api/template.csv` (upload format)
- `GET /api/export.csv` (full export)
- `GET /api/export.csv?final_status=Completed&equipment_type=Vessel`
- `GET /api/export.csv?ids=1,2,3`

## Note on GitHub Pages

GitHub Pages supports static files only. Python APIs will not run there.
Deploy this on a Python host (VM, intranet server, Render/Railway, etc.).
