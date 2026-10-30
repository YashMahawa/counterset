import json
import pytest
from app.config import Config
from app.providers import Gateway, ProviderError, backup_scope
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
    result, meta = g.model("test", "gemini-3.5-flash-lite")
    assert result == {"ok": True} and calls == ["gemini-3.5-flash-lite"] * 2


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


class Reply:
    def __init__(self, status, text='{"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"{}"}]}}]}'):
        self.status_code, self.text, self.headers = status, text, {}

    def json(self):
        return json.loads(self.text)


def rotating(tmp_path, monkeypatch, replies):
    """A gateway with three keys, and a list of which key each call went out on."""
    monkeypatch.setenv("COUNTERSET_PRIVATE_DIR", str(tmp_path))
    monkeypatch.setattr("app.providers.time.sleep", lambda _: None)
    cfg = Config()
    cfg.model_key, cfg.extra_model_keys = "first", ["second", "third"]
    used = []

    class Client:
        def __init__(self, **_):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def post(self, url, headers, json):
            used.append(headers["x-goog-api-key"])
            return replies.pop(0) if replies else Reply(200)

    monkeypatch.setattr("app.providers.httpx.Client", Client)
    return Gateway(cfg), used


def test_the_keys_take_turns(tmp_path, monkeypatch):
    gateway, used = rotating(tmp_path, monkeypatch, [])
    for _ in range(4):
        gateway.model("x")
    assert used == ["first", "second", "third", "first"]


def test_a_limited_key_passes_to_the_next_and_stays_out(tmp_path, monkeypatch):
    gateway, used = rotating(tmp_path, monkeypatch, [Reply(429)])
    gateway.model("x")
    gateway.model("x")
    gateway.model("x")
    assert used == ["first", "second", "third", "second"]


def test_a_refused_key_stays_out_and_is_never_written_down(tmp_path, monkeypatch):
    gateway, used = rotating(tmp_path, monkeypatch, [Reply(403)])
    gateway.model("x")
    gateway.model("x")
    gateway.model("x")
    assert "first" not in used[1:]
    log = (tmp_path / "calls.jsonl").read_text()
    assert not any(k in log for k in ("first", "second", "third"))


def test_when_every_key_fails_it_says_so(tmp_path, monkeypatch):
    gateway, used = rotating(tmp_path, monkeypatch, [Reply(503) for _ in range(9)])
    with pytest.raises(ProviderError, match=r"any of the 3 keys \(HTTP 503\)"):
        gateway.model("x")
    assert set(used) == {"first", "second", "third"} and len(used) == 6



def with_backup(tmp_path, monkeypatch, replies):
    gateway, used = rotating(tmp_path, monkeypatch, replies)
    gateway.cfg.backup_key = "paid"
    return gateway, used


def test_the_paid_key_answers_only_after_every_free_key_fails(tmp_path, monkeypatch):
    gateway, used = with_backup(tmp_path, monkeypatch, [])
    backup_scope("visitor", lambda: gateway.model("x"))()
    assert used == ["first"]
    gateway, used = with_backup(tmp_path, monkeypatch, [Reply(503) for _ in range(6)])
    result, _ = backup_scope("visitor", lambda: gateway.model("x"))()
    assert result == {} and used[-1] == "paid" and used.count("paid") == 1 and len(used) == 7


def test_the_paid_key_never_answers_outside_a_visitors_live_run(tmp_path, monkeypatch):
    gateway, used = with_backup(tmp_path, monkeypatch, [Reply(503) for _ in range(6)])
    with pytest.raises(ProviderError, match="any of the 3 keys"):
        gateway.model("x")
    assert "paid" not in used


def test_the_paid_key_stops_at_the_visitor_cap_then_the_server_cap(tmp_path, monkeypatch):
    gateway, used = with_backup(tmp_path, monkeypatch, [])
    gateway.cfg.model_key, gateway.cfg.extra_model_keys = "first", []
    gateway.cfg.backup_per_visitor_hour = 2
    gateway.cfg.backup_per_hour = 3
    monkeypatch.setattr(gateway, "request", real_or_failing(gateway))
    call = lambda who: backup_scope(who, lambda: gateway.model("x"))()
    call("a")
    call("a")
    with pytest.raises(ProviderError, match="any of the 1 key"):
        call("a")
    call("b")
    with pytest.raises(ProviderError, match="any of the 1 key"):
        call("c")
    assert used.count("paid") == 3


def real_or_failing(gateway):
    """Free keys always fail; the backup key goes through the real caps."""
    real = gateway.request

    def request(provider, path, **kw):
        if provider == "model":
            raise ProviderError("model returned HTTP 503; no action applied")
        return real(provider, path, **kw)

    return request


def test_the_paid_key_expires_and_is_never_written_down(tmp_path, monkeypatch):
    gateway, used = with_backup(tmp_path, monkeypatch, [Reply(503) for _ in range(6)])
    result, _ = backup_scope("10.0.0.9", lambda: gateway.model("x"))()
    log = (tmp_path / "calls.jsonl").read_text()
    assert "paid" not in log and "10.0.0.9" not in log
    gateway, used = with_backup(tmp_path, monkeypatch, [Reply(503) for _ in range(6)])
    gateway.cfg.backup_until = 1
    with pytest.raises(ProviderError):
        backup_scope("visitor", lambda: gateway.model("x"))()
    assert "paid" not in used


def test_a_run_can_choose_how_hard_the_model_thinks(tmp_path, monkeypatch):
    gateway, _ = rotating(tmp_path, monkeypatch, [])
    _, telemetry = gateway.model("x", thinking="low")
    assert telemetry["thinking"] == "low"
    _, telemetry = gateway.model("x")
    assert telemetry["thinking"] == gateway.cfg.thinking
