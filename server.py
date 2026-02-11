#!/usr/bin/env python3
import csv
import io
import json
import os
import sqlite3
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import cgi

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DB_PATH = BASE_DIR / "inspection.db"

OPTIONS = {
    "unit": [
        "GCU-1", "GCU-2", "GPU-1", "GPU-2", "HDPE-1", "HDPE-2", "LLDPE-1", "LLDPE-2",
        "LPG", "PP-1", "PP-2", "SPHERE", "YARD", "FLAKER-1", "BOG", "IOP"
    ],
    "equipment_type": ["Vessel", "Exchanger", "Tank", "Steam Trap", "Pipeline"],
    "inspection_type": ["Planned", "Opportunity Based"],
    "inspection_possible": ["Internal", "External", "Boroscopy", "Cold Work", "Hot Work", "UTG", "LRUT", "RFET"],
    "status": ["Scaffolding Preparation", "Blinding", "Manhole Opening", "NDT in progress", "Deblending", "Handover"],
    "final_status": ["Not Started", "In Progress", "Completed"],
}

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


def now_iso():
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(SCHEMA)
    conn.commit()
    conn.close()


def row_to_dict(row):
    keys = [
        "id", "unit_name", "equipment_type", "equipment_tag_number", "inspection_type", "equipment_name",
        "last_inspection_year", "inspection_possible", "update_date", "inspection_date", "status", "final_status",
        "remarks", "observation", "recommendation", "updated_by", "updated_at"
    ]
    return dict(zip(keys, row))


def with_db(fn):
    def wrapped(*args, **kwargs):
        conn = sqlite3.connect(DB_PATH)
        try:
            return fn(conn, *args, **kwargs)
        finally:
            conn.close()
    return wrapped


@with_db
def get_all_records(conn):
    cur = conn.execute("SELECT * FROM inspections ORDER BY id DESC")
    return [row_to_dict(r) for r in cur.fetchall()]


@with_db
def create_record(conn, payload):
    fields = [
        "unit_name", "equipment_type", "equipment_tag_number", "inspection_type", "equipment_name", "last_inspection_year",
        "inspection_possible", "update_date", "inspection_date", "status", "final_status", "remarks", "observation",
        "recommendation", "updated_by", "updated_at"
    ]
    values = [payload.get(k, "") for k in fields]
    cur = conn.execute(
        f"INSERT INTO inspections ({','.join(fields)}) VALUES ({','.join(['?'] * len(fields))})",
        values,
    )
    conn.commit()
    return cur.lastrowid


@with_db
def update_record(conn, record_id, payload):
    allowed = [
        "unit_name", "equipment_type", "equipment_tag_number", "inspection_type", "equipment_name", "last_inspection_year",
        "inspection_possible", "update_date", "inspection_date", "status", "final_status", "remarks", "observation",
        "recommendation", "updated_by", "updated_at"
    ]
    updates = []
    params = []
    for k in allowed:
        if k in payload:
            updates.append(f"{k} = ?")
            params.append(payload[k])
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
            SET status = ?, final_status = ?, update_date = ?, inspection_date = CASE WHEN ? != '' THEN ? ELSE inspection_date END,
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

    def _serve_static(self):
        target = STATIC_DIR / ("index.html" if self.path in ["/", ""] else self.path.lstrip("/"))
        if not target.exists() or not target.is_file():
            self._send(404, "text/plain", b"Not found")
            return
        mime = "text/html"
        if target.suffix == ".js":
            mime = "application/javascript"
        elif target.suffix == ".css":
            mime = "text/css"
        self._send(200, mime, target.read_bytes())

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
        return self._serve_static()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/records":
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode() or "{}")
            payload["updated_at"] = now_iso()
            if payload.get("final_status") == "Completed" and not payload.get("inspection_date"):
                payload["inspection_date"] = now_iso()
            record_id = create_record(payload)
            return self._json(201, {"id": record_id})

        if parsed.path == "/api/records/bulk-status":
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode() or "{}")
            bulk_update_status(payload.get("ids", []), payload.get("status", ""), payload.get("final_status", ""), payload.get("updated_by", ""))
            return self._json(200, {"ok": True})

        if parsed.path == "/api/records/bulk-upload":
            query = parse_qs(parsed.query)
            role = (query.get("role", [""])[0] or "").lower()
            actor = query.get("user", [""])[0]
            if role != "admin":
                return self._json(403, {"error": "Only admin can bulk upload"})

            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": self.headers.get("Content-Type", "")},
            )
            file_item = form["file"] if "file" in form else None
            if not file_item or not file_item.file:
                return self._json(400, {"error": "Missing file"})
            data = file_item.file.read().decode("utf-8")
            reader = csv.DictReader(io.StringIO(data))
            rows = list(reader)
            insert_bulk(rows, actor)
            return self._json(200, {"inserted": len(rows)})

        self._json(404, {"error": "Not found"})

    def do_PUT(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/records/"):
            return self._json(404, {"error": "Not found"})
        record_id = int(parsed.path.split("/")[-1])
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length).decode() or "{}")
        payload["updated_at"] = now_iso()
        if payload.get("final_status") == "Completed" and not payload.get("inspection_date"):
            payload["inspection_date"] = now_iso()
        update_record(record_id, payload)
        return self._json(200, {"ok": True})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/records/"):
            return self._json(404, {"error": "Not found"})
        query = parse_qs(parsed.query)
        role = (query.get("role", [""])[0] or "").lower()
        if role != "admin":
            return self._json(403, {"error": "Only admin can delete"})
        record_id = int(parsed.path.split("/")[-1])
        delete_record(record_id)
        return self._json(200, {"ok": True})


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Server running on http://0.0.0.0:{port}")
    server.serve_forever()
