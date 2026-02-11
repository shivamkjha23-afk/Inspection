#!/usr/bin/env python3
import csv
import io
import json
import mimetypes
import os
import sqlite3
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse, unquote
import cgi

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "inspection.db"

OPTIONS = {
    "unit": ["GCU-1", "GCU-2", "GPU-1", "GPU-2", "HDPE-1", "HDPE-2", "LLDPE-1", "LLDPE-2", "LPG", "PP-1", "PP-2", "SPHERE", "YARD", "FLAKER-1", "BOG", "IOP"],
    "equipment_type": ["Vessel", "Exchanger", "Tank", "Steam Trap", "Pipeline"],
    "inspection_type": ["Planned", "Opportunity Based"],
    "inspection_possible": ["Internal", "External", "Boroscopy", "Cold Work", "Hot Work", "UTG", "LRUT", "RFET"],
    "status": ["Scaffolding Preparation", "Blinding", "Manhole Opening", "NDT in progress", "Deblending", "Handover"],
    "final_status": ["Not Started", "In Progress", "Completed"],
}

CSV_TEMPLATE_HEADERS = [
    "Unit Name", "Equipment_type", "Equipment_Tag_Number", "Inspection Type", "Equipment Name", "Last Inspection Year",
    "Type of inspection possible", "Update Date", "Inspection Date", "Status", "Final status", "Remarks", "Observation", "Recomendation"
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_name TEXT,
    equipment_type TEXT,
    equipment_tag_number TEXT,
    inspection_type TEXT,
    equipment_name TEXT,
    last_inspection_year TEXT,
    inspection_possible TEXT,
    update_date TEXT,
    inspection_date TEXT,
    status TEXT,
    final_status TEXT,
    remarks TEXT,
    observation TEXT,
    recommendation TEXT,
    updated_by TEXT,
    updated_at TEXT
);
"""

STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/form.html": "form.html",
    "/dashboard.html": "dashboard.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
}


def now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(SCHEMA)
    conn.commit()
    conn.close()


def with_db(fn):
    def wrapped(*args, **kwargs):
        conn = sqlite3.connect(DB_PATH)
        try:
            return fn(conn, *args, **kwargs)
        finally:
            conn.close()
    return wrapped


def row_to_dict(row):
    keys = ["id", "unit_name", "equipment_type", "equipment_tag_number", "inspection_type", "equipment_name", "last_inspection_year", "inspection_possible", "update_date", "inspection_date", "status", "final_status", "remarks", "observation", "recommendation", "updated_by", "updated_at"]
    return dict(zip(keys, row))


@with_db
def get_all_records(conn):
    cur = conn.execute("SELECT * FROM inspections ORDER BY id DESC")
    return [row_to_dict(r) for r in cur.fetchall()]


@with_db
def get_record(conn, record_id):
    cur = conn.execute("SELECT * FROM inspections WHERE id = ?", (record_id,))
    row = cur.fetchone()
    return row_to_dict(row) if row else None


@with_db
def create_record(conn, payload):
    fields = ["unit_name", "equipment_type", "equipment_tag_number", "inspection_type", "equipment_name", "last_inspection_year", "inspection_possible", "update_date", "inspection_date", "status", "final_status", "remarks", "observation", "recommendation", "updated_by", "updated_at"]
    values = [payload.get(k, "") for k in fields]
    cur = conn.execute(f"INSERT INTO inspections ({','.join(fields)}) VALUES ({','.join(['?'] * len(fields))})", values)
    conn.commit()
    return cur.lastrowid


@with_db
def update_record(conn, record_id, payload):
    allowed = ["unit_name", "equipment_type", "equipment_tag_number", "inspection_type", "equipment_name", "last_inspection_year", "inspection_possible", "update_date", "inspection_date", "status", "final_status", "remarks", "observation", "recommendation", "updated_by", "updated_at"]
    updates = []
    params = []
    for key in allowed:
        if key in payload:
            updates.append(f"{key} = ?")
            params.append(payload[key])
    if not updates:
        return
    params.append(record_id)
    conn.execute(f"UPDATE inspections SET {','.join(updates)} WHERE id = ?", params)
    conn.commit()


@with_db
def delete_record(conn, record_id):
    conn.execute("DELETE FROM inspections WHERE id = ?", (record_id,))
    conn.commit()


@with_db
def bulk_update_status(conn, ids, status, final_status, actor):
    update_date = now_iso()
    inspection_date = update_date if final_status == "Completed" else ""
    for record_id in ids:
        conn.execute(
            """
            UPDATE inspections
            SET status = ?, final_status = ?, update_date = ?,
                inspection_date = CASE WHEN ? != '' THEN ? ELSE inspection_date END,
                updated_by = ?, updated_at = ?
            WHERE id = ?
            """,
            (status, final_status, update_date, inspection_date, inspection_date, actor, update_date, record_id),
        )
    conn.commit()


@with_db
def insert_bulk(conn, rows, actor):
    for row in rows:
        payload = {
            "unit_name": row.get("Unit Name", ""),
            "equipment_type": row.get("Equipment_type", ""),
            "equipment_tag_number": row.get("Equipment_Tag_Number", ""),
            "inspection_type": row.get("Inspection Type", ""),
            "equipment_name": row.get("Equipment Name", ""),
            "last_inspection_year": row.get("Last Inspection Year", ""),
            "inspection_possible": row.get("Type of inspection possible", ""),
            "update_date": row.get("Update Date", ""),
            "inspection_date": row.get("Inspection Date", ""),
            "status": row.get("Status", ""),
            "final_status": row.get("Final status", "Not Started"),
            "remarks": row.get("Remarks", ""),
            "observation": row.get("Observation", ""),
            "recommendation": row.get("Recomendation", ""),
            "updated_by": actor,
            "updated_at": now_iso(),
        }
        create_record(payload)


def parse_json_body(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    raw = handler.rfile.read(length).decode() if length else "{}"
    return json.loads(raw or "{}")


def role_from_query(parsed, default="user"):
    query = parse_qs(parsed.query)
    return (query.get("role", [""])[0] or default).lower()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code=200, content_type="application/json", body=None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if body is not None:
            self.wfile.write(body)

    def _json(self, code, payload):
        self._send(code, "application/json", json.dumps(payload).encode())

    def _serve_file(self, relative_path):
        file_path = BASE_DIR / "static" / relative_path
        if not file_path.exists() or not file_path.is_file():
            return self._send(404, "text/plain", b"Not found")
        mime, _ = mimetypes.guess_type(str(file_path))
        self._send(200, mime or "application/octet-stream", file_path.read_bytes())

    def _serve_static(self):
        req_path = unquote(urlparse(self.path).path)
        if req_path not in STATIC_FILES:
            return self._send(404, "text/plain", b"Not found")
        return self._serve_file(STATIC_FILES[req_path])

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/options":
            return self._json(200, OPTIONS)
        if parsed.path == "/api/records":
            return self._json(200, get_all_records())
        if parsed.path.startswith("/api/records/"):
            rec_id = int(parsed.path.split("/")[-1])
            rec = get_record(rec_id)
            return self._json(200, rec) if rec else self._json(404, {"error": "Record not found"})
        if parsed.path == "/api/template.csv":
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(CSV_TEMPLATE_HEADERS)
            data = output.getvalue().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv")
            self.send_header("Content-Disposition", 'attachment; filename="inspection_bulk_template.csv"')
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
            return
        return self._serve_static()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/records":
            role = role_from_query(parsed)
            if role == "management":
                return self._json(403, {"error": "Management role is view-only"})
            payload = parse_json_body(self)
            payload["updated_at"] = now_iso()
            if payload.get("final_status") == "Completed" and not payload.get("inspection_date"):
                payload["inspection_date"] = now_iso()
            if not payload.get("update_date"):
                payload["update_date"] = now_iso()
            return self._json(201, {"id": create_record(payload)})

        if parsed.path == "/api/records/bulk-status":
            role = role_from_query(parsed)
            if role == "management":
                return self._json(403, {"error": "Management role is view-only"})
            payload = parse_json_body(self)
            ids = [int(x) for x in payload.get("ids", [])]
            if not ids:
                return self._json(400, {"error": "Please select at least one item"})
            bulk_update_status(ids, payload.get("status", ""), payload.get("final_status", ""), payload.get("updated_by", ""))
            return self._json(200, {"ok": True})

        if parsed.path == "/api/records/bulk-upload":
            query = parse_qs(parsed.query)
            role = (query.get("role", [""])[0] or "").lower()
            actor = query.get("user", [""])[0]
            if role != "admin":
                return self._json(403, {"error": "Only admin can bulk upload"})
            form = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": self.headers.get("Content-Type", "")})
            file_item = form["file"] if "file" in form else None
            if not file_item or not file_item.file:
                return self._json(400, {"error": "Missing file"})
            data = file_item.file.read().decode("utf-8")
            rows = list(csv.DictReader(io.StringIO(data)))
            insert_bulk(rows, actor)
            return self._json(200, {"inserted": len(rows)})

        return self._json(404, {"error": "Not found"})

    def do_PUT(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/records/"):
            return self._json(404, {"error": "Not found"})
        role = role_from_query(parsed)
        if role == "management":
            return self._json(403, {"error": "Management role is view-only"})
        rec_id = int(parsed.path.split("/")[-1])
        payload = parse_json_body(self)
        payload["updated_at"] = now_iso()
        if payload.get("final_status") == "Completed" and not payload.get("inspection_date"):
            payload["inspection_date"] = now_iso()
        if not payload.get("update_date"):
            payload["update_date"] = now_iso()
        update_record(rec_id, payload)
        return self._json(200, {"ok": True})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/records/"):
            return self._json(404, {"error": "Not found"})
        role = role_from_query(parsed, default="")
        if role != "admin":
            return self._json(403, {"error": "Only admin can delete"})
        rec_id = int(parsed.path.split("/")[-1])
        delete_record(rec_id)
        return self._json(200, {"ok": True})


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "8000"))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Server running on http://0.0.0.0:{port}")
    httpd.serve_forever()
