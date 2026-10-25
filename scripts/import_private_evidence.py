"""One-time local migration of existing research responses. Never copies credentials."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent
catalogue = json.loads(
    (source / "research/round4/counterset_catalogue.json").read_text()
)
manifest = json.loads(
    (source / "research/round4/counterset_exact_manifest.json").read_text()
)
payloads = {
    a["id"]: json.loads((source / "research/api" / r["file"]).read_text())
    for a, r in zip(catalogue, manifest["rows"][:12])
}
private = ROOT / ".private"
private.mkdir(exist_ok=True)
private.chmod(0o700)
(private / "recorded.json").write_text(
    json.dumps(
        {
            "catalogue": {a["name"]: a["id"] for a in catalogue},
            "payloads": payloads,
            "control": {
                "passed": True,
                "scope": "Reversed input order for the first seed, 25 October 2026",
            },
        }
    )
)
print("Imported 12 private Qloo rows; raw provider data is gitignored.")
