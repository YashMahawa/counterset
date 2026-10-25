import pytest
from app.config import Config
from app.providers import Gateway, ProviderError
from app.agent import check_item, to_minutes
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


def test_unquoted_wrong_act_or_bad_time_cannot_apply():
    day = demo()
    note = "Flying Lotus after 17:00"
    for item in [
        {"action": "not_before", "act_id": "invented", "time": "17:00", "quote": "after 17:00"},
        {"action": "not_before", "act_id": "act-0", "time": "17:00", "quote": "unquoted"},
        {"action": "not_before", "act_id": "act-0", "time": "5pm", "quote": "after 17:00"},
        {"action": "not_before", "act_id": "act-0", "time": "19:30", "quote": "after 17:00"},
        {"action": "publish", "quote": "after 17:00"},
    ]:
        with pytest.raises(ValueError):
            check_item(day, item, note)
    ok = check_item(day, {"action": "not_before", "act_id": "act-0", "time": "17:00", "quote": "after 17:00"}, note)
    assert ok["value"] == 1020


def test_after_midnight_times_roll_forward():
    day = demo()
    assert to_minutes(day, "01:00") == 1500 and to_minutes(day, "16:30") == 990


def test_offline_cache_never_calls_network(tmp_path, monkeypatch):
    from app.evidence import NotCached

    cfg = Config(root=tmp_path)
    cfg.private = tmp_path
    g = Gateway(cfg)
    monkeypatch.setattr(g, "request", lambda *a, **k: (_ for _ in ()).throw(AssertionError("network")))
    with pytest.raises(NotCached):
        g.qloo("/v2/insights", {"x": 1}, offline=True)
