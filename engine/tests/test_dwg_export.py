"""DWG export: DXF→DWG bridge unit logic + POST /export/floorplan-dwg wiring.

Real DWG conversion needs the ODA File Converter, which is not present in CI, so
the success path is exercised with a stubbed converter; the missing-converter
path is verified end-to-end (it must degrade to HTTP 503, never 500).
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from fastapi.testclient import TestClient

import plana_engine.importers.dwg as dwg_mod
from plana_engine.api.main import app
from plana_engine.auth.jwt_utils import create_token
from plana_engine.importers.dwg import DwgConversionError, DwgExportResult, dxf_to_dwg

_client = TestClient(app)
_AUTH = {"Authorization": f"Bearer {create_token('t', 't@e.kz', 'user')}"}
_BODY = {"site_width_m": 30.0, "site_depth_m": 15.0, "floors": 5, "sections": 2}


# ── unit: bridge ───────────────────────────────────────────────────────────


def test_empty_dxf_raises() -> None:
    with pytest.raises(DwgConversionError):
        dxf_to_dwg(b"")


def test_no_converter_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dwg_mod, "_find_oda_converter", lambda: None)
    with pytest.raises(DwgConversionError, match="ODA"):
        dxf_to_dwg(b"0\nSECTION\n", filename="x.dxf")


def test_dangling_env_path_is_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    """Несуществующий ODA_FILE_CONVERTER (как в образе без vendored .deb) не
    должен выдаваться за рабочий конвертер — иначе будет 500 вместо 503.

    Машинно-независимо: если на хосте есть настоящий ODA, finder может вернуть
    его через fallback — но никогда сам висячий explicit-путь."""
    dangling = "/usr/local/bin/oda-convert-does-not-exist"
    monkeypatch.delenv("PLANA_DWG_CONVERTER", raising=False)
    monkeypatch.setenv("ODA_FILE_CONVERTER", dangling)
    res = dwg_mod._find_oda_converter()
    assert res is None or res.path != dangling


def test_real_roundtrip_if_available() -> None:
    """Настоящая конвертация DXF→DWG, если ODA установлен (иначе skip)."""
    if dwg_mod._find_oda_converter() is None:
        pytest.skip("ODA File Converter not installed on this host")

    from plana_engine.cad.floorplan_dxf import build_floorplan_dxf
    from plana_engine.visualizer.marketing_prompt import MarketingInputs

    dxf_bytes = build_floorplan_dxf(
        MarketingInputs(site_width_m=30.0, site_depth_m=15.0, floors=5, sections=2)
    )
    res = dxf_to_dwg(dxf_bytes, filename="rt.dxf")
    # DWG-файлы начинаются с маркера версии "AC10xx".
    assert res.dwg_bytes[:2] == b"AC"
    assert len(res.dwg_bytes) > 1000


# ── endpoint wiring ────────────────────────────────────────────────────────


def test_endpoint_503_when_converter_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Без конвертера эндпоинт деградирует в 503, а не 500."""
    monkeypatch.setattr(dwg_mod, "_find_oda_converter", lambda: None)
    r = _client.post("/export/floorplan-dwg", headers=_AUTH, json=_BODY)
    assert r.status_code == 503
    assert "ODA" in r.text


def test_endpoint_success_with_stub_converter(monkeypatch: pytest.MonkeyPatch) -> None:
    """С (заглушечным) конвертером отдаётся .dwg + метрики в заголовках."""
    def _fake(dxf_bytes: bytes, **_kw: object) -> DwgExportResult:
        assert dxf_bytes  # реальный DXF должен быть построен до конвертации
        return DwgExportResult(dwg_bytes=b"FAKE-DWG-BYTES", converter="oda")

    monkeypatch.setattr(dwg_mod, "dxf_to_dwg", _fake)
    r = _client.post("/export/floorplan-dwg", headers=_AUTH, json=_BODY)
    assert r.status_code == 200
    assert r.content == b"FAKE-DWG-BYTES"
    assert r.headers["content-type"].startswith("application/acad")
    assert "plana-floorplan.dwg" in r.headers["content-disposition"]
    assert r.headers["X-Converter"] == "oda"
    assert int(r.headers["X-Apartments-Count"]) >= 0
