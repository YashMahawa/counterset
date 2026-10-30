"""Private worked examples: real published days and rehearsal days with their evidence.

Example files hold derived ranks, never raw Qloo payloads, and live in the
ignored private folder. A fresh clone has none and must query its own lineup.
"""

import json
from fastapi import HTTPException
from . import lineup
from .domain import Day


class Examples:
    def __init__(self, folder):
        self.folder = folder

    def files(self):
        return sorted(self.folder.glob("*.json")) if self.folder.exists() else []

    def list(self):
        out = []
        for f in self.files():
            data = json.loads(f.read_text())
            out.append(
                {
                    "id": f.stem,
                    "title": data["context"]["title"],
                    "summary": data["context"].get("summary", ""),
                    "kind": data["context"]["kind"],
                    "acts": len(data["day"]["acts"]),
                    "stages": len(data["day"]["stages"]),
                    "order": data["context"].get("order", 9),
                }
            )
        return sorted(out, key=lambda x: x["order"])

    def templates(self):
        """The days offered to try, as text a person can change."""
        out = []
        for item in self.list():
            data = self.get(item["id"])
            day = Day.model_validate(data["day"])
            c = data["context"]
            out.append({"id": item["id"], "name": day.name, "title": c["title"], "why": c.get("why", c.get("summary", "")), "text": lineup.text_of(day), "message": c.get("sample_message", ""), "acts": item["acts"], "stages": item["stages"], "source": c.get("source")})
        return out

    def get(self, example_id):
        f = self.folder / f"{example_id}.json"
        if not example_id.replace("-", "").isalnum() or not f.exists():
            raise HTTPException(404, "Example not available on this installation")
        return json.loads(f.read_text())
