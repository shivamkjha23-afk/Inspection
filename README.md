# ATR 2026 Inspection Tracker

Simple web app for PATA plant daily inspection tracking with three roles:

- **EIS User**: create/update records, status updates, multi-record status update.
- **Admin**: everything a user can do + bulk CSV upload + record deletion.
- **Management**: dashboard/table view only.

## Features

- Dropdown values for Unit, Equipment Type, Inspection Type, Type of Inspection Possible, Status, Final Status.
- Mark Complete button auto-populates update date and inspection date.
- Bulk status update by record IDs.
- Store `updated_by` and `updated_at` for each change.
- Shared SQLite database (`inspection.db`) usable by all users of the deployed server.

## Run

```bash
python3 server.py
```

Open http://localhost:8000

## CSV Upload

Admin can upload CSV with headers like:

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
