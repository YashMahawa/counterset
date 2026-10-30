from dataclasses import dataclass
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_env(path, raw_name=None):
    if not path:
        return {}
    try:
        text = Path(path).expanduser().read_text().strip()
    except OSError:
        return {}
    if raw_name and "\n" not in text and "=" not in text:
        return {raw_name: text}
    result = {}
    for line in text.splitlines():
        line = line.strip().removeprefix("export ")
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            result[k.strip()] = v.strip().strip("\"'")
    return result


@dataclass
class Config:
    root: Path = ROOT

    def __post_init__(self):
        local = read_env(self.root / ".env")
        self.values = {**local, **os.environ}
        self.private = Path(
            self.values.get("COUNTERSET_PRIVATE_DIR", str(self.root / ".private"))
        )
        self.private.mkdir(parents=True, exist_ok=True)
        self.private.chmod(0o700)
        q = read_env(self.values.get("QLOO_ENV_FILE"), "QLOO_API_KEY")
        free = read_env(self.values.get("GEMINI_ENV_FILE"))
        self.qloo_key = self.values.get("QLOO_API_KEY") or next(
            (
                v
                for k, v in q.items()
                if "QLOO" in k.upper() and ("KEY" in k.upper() or "TOKEN" in k.upper())
            ),
            None,
        )
        self.model_key = self.values.get("GEMINI_FREE_API_KEY") or free.get(
            "GEMINI_FREE_API_KEY"
        )
        self.model = "gemma-4-31b-it"
        self.models = ["gemma-4-31b-it", "gemini-3.5-flash-lite"]
        self.limit = min(5000, int(self.values.get("QLOO_SUCCESS_LIMIT", "5000")))
        self.prior = int(self.values.get("QLOO_PRIOR_SUCCESS", "0"))
        self.model_limit = int(self.values.get("MODEL_CALL_LIMIT", "500"))
        self.access_token = self.values.get("COUNTERSET_ACCESS_TOKEN", "")
        # Public mode: open to anyone, no live Qloo spending, live agent runs capped per visitor.
        self.public = self.values.get("COUNTERSET_PUBLIC", "").lower() in {"1", "true", "yes"}
        # Unlisted: reachable by link, but asks search engines and AI crawlers to stay out.
        self.unlisted = self.values.get("COUNTERSET_UNLISTED", "").lower() in {"1", "true", "yes"}
        self.agent_per_hour = int(self.values.get("AGENT_RUNS_PER_VISITOR_HOUR", "3"))
        self.agent_per_day = int(self.values.get("AGENT_RUNS_PER_DAY", "40"))
