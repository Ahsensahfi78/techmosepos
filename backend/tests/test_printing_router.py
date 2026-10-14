"""Raw printing endpoint.

None of this touches the database — printing is a device operation, so a
spooler failure must never be able to roll anything back. The backend is
swapped for a mock on every call: a test must never make the machine's real
printers do anything.
"""

import base64

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import auth
from app.routers import printing as printing_router
from app.services.printing.backends import (
    MockPrinterBackend,
    UnsupportedPrinterBackend,
    make_printer,
)


class _FakeUser:
    role = "super_admin"


def _fake_current_user() -> _FakeUser:
    # Takes no arguments on purpose: FastAPI builds the dependency's parameter
    # list from the override's signature, so anything like *args would be
    # interpreted as query-string parameters.
    return _FakeUser()


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(printing_router.router)
    # require_permission is a factory, so it is already bound to the inner
    # checker by the time the router registers its routes. Overriding the
    # user dependency underneath it is what actually short-circuits auth here.
    app.dependency_overrides[auth.get_current_user] = _fake_current_user
    return TestClient(app)


@pytest.fixture()
def mock_backend():
    return MockPrinterBackend([make_printer("XP-365B")])


def test_requires_a_printer_name(client):
    res = client.post("/printing/raw", json={"data_b64": "Q0xT"})
    assert res.status_code == 422


def test_rejects_malformed_base64(client, monkeypatch):
    monkeypatch.setattr(printing_router, "get_backend", lambda: MockPrinterBackend())
    res = client.post("/printing/raw", json={"printer": "XP-365B", "data_b64": "!!!"})
    assert res.status_code == 422
    assert "base64" in res.json()["detail"]


def test_rejects_an_empty_payload(client, monkeypatch):
    monkeypatch.setattr(printing_router, "get_backend", lambda: MockPrinterBackend())
    res = client.post("/printing/raw", json={"printer": "XP-365B", "data_b64": ""})
    assert res.status_code == 422


def test_rejects_an_oversized_payload(client, monkeypatch):
    monkeypatch.setattr(printing_router, "get_backend", lambda: MockPrinterBackend())
    blob = base64.b64encode(b"x" * (printing_router.MAX_RAW_BYTES + 1)).decode()
    res = client.post("/printing/raw", json={"printer": "XP-365B", "data_b64": blob})
    assert res.status_code == 413


def test_503_when_the_platform_cannot_print(client, monkeypatch):
    monkeypatch.setattr(
        printing_router,
        "get_backend",
        lambda: UnsupportedPrinterBackend("no print API on this host"),
    )
    blob = base64.b64encode(b"CLS\r\nPRINT 1\r\n").decode()
    res = client.post("/printing/raw", json={"printer": "XP-365B", "data_b64": blob})
    assert res.status_code == 503
    assert "no print API" in res.json()["detail"]


def test_sends_tspl_as_raw_bytes(client, mock_backend, monkeypatch):
    monkeypatch.setattr(printing_router, "get_backend", lambda: mock_backend)
    job = "SIZE 38 mm, 25 mm\r\nGAP 2 mm, 0 mm\r\nCLS\r\nPRINT 1\r\n"
    res = client.post(
        "/printing/raw",
        json={"printer": "XP-365B", "data_b64": base64.b64encode(job.encode()).decode()},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["bytes_sent"] == len(job.encode())
    assert body["bytes_written"] == len(job.encode())
    # The bytes land unmodified — no driver can rewrite them on the way.
    assert len(mock_backend.raw_jobs) == 1
    printer, sent = mock_backend.raw_jobs[0]
    assert printer == "XP-365B"
    assert sent == job.encode()


def test_502_when_the_queue_refuses_the_job(client, monkeypatch):
    backend = MockPrinterBackend([make_printer("Good")])
    backend.reject_printer = "Good"
    monkeypatch.setattr(printing_router, "get_backend", lambda: backend)
    blob = base64.b64encode(b"CLS").decode()
    res = client.post("/printing/raw", json={"printer": "Good", "data_b64": blob})
    assert res.status_code == 502
    assert "not available" in res.json()["detail"]


def test_lists_printers_without_touching_the_database(client, mock_backend, monkeypatch):
    monkeypatch.setattr(printing_router, "get_backend", lambda: mock_backend)
    res = client.get("/printing/printers")
    assert res.status_code == 200
    body = res.json()
    assert body["supported"] is True
    assert [p["name"] for p in body["printers"]] == ["XP-365B"]


def test_uses_a_real_mock_job_counter():
    # Guard against the raw path silently no-op'ing on a mock.
    backend = MockPrinterBackend([make_printer("XP-365B")])
    result = backend.submit_raw("XP-365B", b"CLS\r\n")
    assert result.ok is True
    assert result.bytes_sent == 5
    assert result.bytes_written == 5
    assert backend.raw_jobs == [("XP-365B", b"CLS\r\n")]
