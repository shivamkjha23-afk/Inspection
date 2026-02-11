# ATR 2026 Inspection Tracker (PATA Plant)

This is a multi-page website with Python backend + SQLite database.

## Pages

- `index.html` → Inspection list page
  - select records with checkboxes
  - bulk status update on selected records
  - admin bulk CSV upload
  - download CSV template for upload format
- `form.html` → Add/Edit form page
  - full form with dropdowns
  - auto-fill completion with **Mark Completed** button
- `dashboard.html` → Management dashboard page
  - KPI summary and recent status table

## Roles

- **EIS User**: create/update records
- **Admin**: user permissions + bulk upload + delete
- **Management**: view-only

## Run

```bash
python3 server.py
```

Open:
- `http://localhost:8000/index.html`
- `http://localhost:8000/form.html`
- `http://localhost:8000/dashboard.html`

## Bulk upload format

Download template from:

- `http://localhost:8000/api/template.csv`

Required CSV headers:

- `Unit Name`
- `Equipment_type`
- `Equipment_Tag_Number`
- `Inspection Type`
- `Equipment Name`
- `Last Inspection Year`
- `Type of inspection possible`
- `Update Date`
- `Inspection Date`
- `Status`
- `Final status`
- `Remarks`
- `Observation`
- `Recomendation`

## Notes

- Data is shared in `inspection.db` on the server.
- For GitHub-hosted static sites (GitHub Pages), Python backend will not run there.
  Deploy this to a Python-capable host or local/intranet server.
