import pytest
from app.config import Config
from app.providers import Gateway, ProviderError
from app.agent import propose_constraint
from app.fixtures import demo


def test_key_sources_are_explicit_and_no_paid_key_fallback(tmp_path, monkeypatch):
    monkeypatch.delenv("GEMINI_FREE_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_ENV_FILE", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "paid-key-must-not-be-used")
    cfg = Config(root=tmp_path)
    assert cfg.model_key is None


def test_model_retries_server_error_without_changing_model(tmp_path, monkeypatch):
    cfg = Config(root=tmp_path)
    g = Gateway(cfg)
    calls = []

    def request(provider, path, **kw):
        calls.append(kw["model"])
        if len(calls) == 1:
            raise ProviderError("model returned HTTP 500")
        return {
            "candidates": [
                {
                    "finishReason": "STOP",
                    "content": {"parts": [{"text": '{"ok":true}'}]},
                }
            ]
        }

    monkeypatch.setattr(g, "request", request)
    monkeypatch.setattr("app.providers.time.sleep", lambda _: None)
    result, meta = g.model("test", "gemma-4-31b-it")
    assert result == {"ok": True} and calls == ["gemma-4-31b-it"] * 2


def test_unquoted_or_wrong_act_constraint_cannot_apply(tmp_path):
    class G:
        def model(self, *args):
            return {
                "action": "earliest",
                "act_id": "invented",
                "value": 1000,
                "quote": "unquoted",
                "reason": "test",
            }, {}

    with pytest.raises(ValueError):
        propose_constraint(demo(), "Flying Lotus after 17:00", G(), "gemma-4-31b-it")
