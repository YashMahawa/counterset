import json
import sqlite3
import threading
import uuid
from fastapi import HTTPException


class Store:
    def __init__(self, path):
        self.path = path
        self.lock = threading.RLock()
        with self.connect() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS records (kind TEXT,id TEXT,data TEXT,PRIMARY KEY(kind,id))"
            )

    def connect(self):
        return sqlite3.connect(self.path, timeout=20)

    def put(self, kind, data, id=None):
        id = id or uuid.uuid4().hex
        with self.lock, self.connect() as c:
            c.execute(
                "INSERT OR REPLACE INTO records VALUES(?,?,?)",
                (kind, id, json.dumps(data)),
            )
        return id

    def get(self, kind, id):
        with self.connect() as c:
            r = c.execute(
                "SELECT data FROM records WHERE kind=? AND id=?", (kind, id)
            ).fetchone()
        if not r:
            raise HTTPException(404, "Record not found")
        return json.loads(r[0])

    def list(self, kind):
        with self.connect() as c:
            rows = c.execute(
                "SELECT id,data FROM records WHERE kind=? ORDER BY rowid DESC", (kind,)
            ).fetchall()
        return [{"id": id, **json.loads(data)} for id, data in rows]
