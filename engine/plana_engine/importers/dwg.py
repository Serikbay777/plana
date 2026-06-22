"""DWG -> DXF conversion bridge for P2 CAD import.

DWG is a closed binary AutoCAD format, so we do not parse it directly. The
practical path is to call an external converter (ODA File Converter preferred,
LibreDWG `dwg2dxf` as fallback), then feed the produced DXF into the existing
DXF importer.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path


class DwgConversionError(RuntimeError):
    """Raised when DWG conversion is unavailable or failed."""


@dataclass(frozen=True)
class DwgConversionResult:
    dxf_bytes: bytes
    converter: str


@dataclass(frozen=True)
class DwgExportResult:
    dwg_bytes: bytes
    converter: str


@dataclass(frozen=True)
class _Converter:
    kind: str
    path: str


def dwg_to_dxf(dwg_bytes: bytes, *, filename: str = "input.dwg", timeout_s: int = 90) -> DwgConversionResult:
    """Convert DWG bytes to ASCII DXF bytes through an external converter."""
    if not dwg_bytes:
        raise DwgConversionError("empty DWG")

    converter = _find_converter()
    if converter is None:
        raise DwgConversionError(
            "DWG converter is not configured. Install ODA File Converter or LibreDWG "
            "and set ODA_FILE_CONVERTER / PLANA_DWG_CONVERTER / DWG2DXF_BIN."
        )

    with tempfile.TemporaryDirectory(prefix="plana-dwg-") as tmp:
        root = Path(tmp)
        if converter.kind == "oda":
            dxf_bytes = _convert_with_oda(converter.path, root, dwg_bytes, filename, timeout_s)
        else:
            dxf_bytes = _convert_with_libredwg(converter.path, root, dwg_bytes, filename, timeout_s)
    return DwgConversionResult(dxf_bytes=dxf_bytes, converter=converter.kind)


def dxf_to_dwg(
    dxf_bytes: bytes,
    *,
    filename: str = "floorplan.dxf",
    out_version: str = "ACAD2018",
    timeout_s: int = 90,
) -> DwgExportResult:
    """Convert ASCII DXF bytes to DWG bytes through an external converter.

    Mirror of :func:`dwg_to_dxf` for the export direction. Only the ODA File
    Converter qualifies here: LibreDWG ``dwg2dxf`` is one-way (DWG→DXF), so the
    LibreDWG fallback used for import is not usable for export.
    """
    if not dxf_bytes:
        raise DwgConversionError("empty DXF")

    converter = _find_oda_converter()
    if converter is None:
        raise DwgConversionError(
            "DWG export requires the ODA File Converter (DXF→DWG). Install it and "
            "set ODA_FILE_CONVERTER / PLANA_DWG_CONVERTER. LibreDWG dwg2dxf cannot "
            "export DWG."
        )

    with tempfile.TemporaryDirectory(prefix="plana-dxf2dwg-") as tmp:
        dwg_bytes = _convert_with_oda_to_dwg(
            converter.path, Path(tmp), dxf_bytes, filename, out_version, timeout_s
        )
    return DwgExportResult(dwg_bytes=dwg_bytes, converter=converter.kind)


def _find_oda_converter() -> _Converter | None:
    """Find an ODA File Converter only (used for export; ignores LibreDWG).

    The explicit env path is validated for existence: the Docker image sets
    ODA_FILE_CONVERTER unconditionally, but the wrapper only exists when an ODA
    .deb was vendored. A dangling path must fall through to None (→ HTTP 503),
    not be returned (→ subprocess FileNotFoundError → HTTP 500).
    """
    explicit = (
        os.environ.get("PLANA_DWG_CONVERTER")
        or os.environ.get("ODA_FILE_CONVERTER")
    )
    if explicit and (os.path.exists(explicit) or shutil.which(explicit)):
        return _Converter("oda", explicit)

    for candidate in ("ODAFileConverter", "ODAFileConverter.exe"):
        found = shutil.which(candidate)
        if found:
            return _Converter("oda", found)

    for candidate_path in _common_oda_paths():
        if candidate_path.exists():
            return _Converter("oda", str(candidate_path))

    return None


def _find_converter() -> _Converter | None:
    explicit = (
        os.environ.get("PLANA_DWG_CONVERTER")
        or os.environ.get("ODA_FILE_CONVERTER")
    )
    if explicit:
        return _Converter("oda", explicit)

    libredwg_explicit = os.environ.get("DWG2DXF_BIN")
    if libredwg_explicit:
        return _Converter("libredwg", libredwg_explicit)

    for candidate in ("ODAFileConverter", "ODAFileConverter.exe"):
        found = shutil.which(candidate)
        if found:
            return _Converter("oda", found)

    for candidate_path in _common_oda_paths():
        if candidate_path.exists():
            return _Converter("oda", str(candidate_path))

    for candidate in ("dwg2dxf", "dwg2dxf.exe"):
        found = shutil.which(candidate)
        if found:
            return _Converter("libredwg", found)

    return None


def _common_oda_paths() -> list[Path]:
    roots = [
        Path("C:/Program Files/ODA"),
        Path("C:/Program Files (x86)/ODA"),
        Path("/opt/oda"),
        Path("/usr/local/bin"),
        Path("/usr/bin"),
    ]
    paths: list[Path] = []
    for root in roots:
        if not root.exists():
            continue
        if root.is_file() and root.name.lower().startswith("odafileconverter"):
            paths.append(root)
            continue
        try:
            paths.extend(root.glob("**/ODAFileConverter.exe"))
            paths.extend(root.glob("**/ODAFileConverter"))
        except OSError:
            continue
    return paths


def _convert_with_oda(
    bin_path: str,
    root: Path,
    dwg_bytes: bytes,
    filename: str,
    timeout_s: int,
) -> bytes:
    in_dir = root / "in"
    out_dir = root / "out"
    in_dir.mkdir()
    out_dir.mkdir()
    safe_name = _safe_dwg_filename(filename)
    in_file = in_dir / safe_name
    in_file.write_bytes(dwg_bytes)

    result = subprocess.run(
        [bin_path, str(in_dir), str(out_dir), "ACAD2018", "DXF", "0", "1"],
        capture_output=True,
        timeout=timeout_s,
        check=False,
    )
    if result.returncode != 0:
        raise DwgConversionError(_format_converter_error("ODA File Converter", result))

    out_file = _find_output_dxf(out_dir, in_file.stem)
    if out_file is None:
        raise DwgConversionError("ODA File Converter finished but produced no DXF output")
    return out_file.read_bytes()


def _convert_with_oda_to_dwg(
    bin_path: str,
    root: Path,
    dxf_bytes: bytes,
    filename: str,
    out_version: str,
    timeout_s: int,
) -> bytes:
    in_dir = root / "in"
    out_dir = root / "out"
    in_dir.mkdir()
    out_dir.mkdir()
    safe_name = _safe_dxf_filename(filename)
    in_file = in_dir / safe_name
    in_file.write_bytes(dxf_bytes)

    # ODAFileConverter <in> <out> <out_version> <out_format> <recurse> <audit> [filter]
    result = subprocess.run(
        [bin_path, str(in_dir), str(out_dir), out_version, "DWG", "0", "1", "*.DXF"],
        capture_output=True,
        timeout=timeout_s,
        check=False,
    )
    if result.returncode != 0:
        raise DwgConversionError(_format_converter_error("ODA File Converter", result))

    out_file = _find_output_dwg(out_dir, in_file.stem)
    if out_file is None:
        raise DwgConversionError("ODA File Converter finished but produced no DWG output")
    return out_file.read_bytes()


def _convert_with_libredwg(
    bin_path: str,
    root: Path,
    dwg_bytes: bytes,
    filename: str,
    timeout_s: int,
) -> bytes:
    in_file = root / _safe_dwg_filename(filename)
    out_file = root / f"{in_file.stem}.dxf"
    in_file.write_bytes(dwg_bytes)

    result = subprocess.run(
        [bin_path, "-o", str(out_file), str(in_file)],
        capture_output=True,
        timeout=timeout_s,
        check=False,
    )
    if result.returncode != 0:
        raise DwgConversionError(_format_converter_error("LibreDWG dwg2dxf", result))
    if not out_file.exists():
        raise DwgConversionError("LibreDWG dwg2dxf finished but produced no DXF output")
    return out_file.read_bytes()


def _safe_dwg_filename(filename: str) -> str:
    stem = Path(filename or "input.dwg").stem or "input"
    clean = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in stem)[:80]
    return f"{clean or 'input'}.dwg"


def _safe_dxf_filename(filename: str) -> str:
    stem = Path(filename or "floorplan.dxf").stem or "floorplan"
    clean = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in stem)[:80]
    return f"{clean or 'floorplan'}.dxf"


def _find_output_dwg(out_dir: Path, stem: str) -> Path | None:
    exact = out_dir / f"{stem}.dwg"
    if exact.exists():
        return exact
    exact_upper = out_dir / f"{stem}.DWG"
    if exact_upper.exists():
        return exact_upper
    found = sorted(out_dir.glob("*.dwg")) + sorted(out_dir.glob("*.DWG"))
    return found[0] if found else None


def _find_output_dxf(out_dir: Path, stem: str) -> Path | None:
    exact = out_dir / f"{stem}.dxf"
    if exact.exists():
        return exact
    exact_upper = out_dir / f"{stem}.DXF"
    if exact_upper.exists():
        return exact_upper
    found = sorted(out_dir.glob("*.dxf")) + sorted(out_dir.glob("*.DXF"))
    return found[0] if found else None


def _format_converter_error(name: str, result: subprocess.CompletedProcess[bytes]) -> str:
    stderr = result.stderr.decode("utf-8", errors="replace").strip()
    stdout = result.stdout.decode("utf-8", errors="replace").strip()
    detail = stderr or stdout or f"exit code {result.returncode}"
    return f"{name} failed: {detail[:1200]}"


__all__ = [
    "DwgConversionError",
    "DwgConversionResult",
    "DwgExportResult",
    "dwg_to_dxf",
    "dxf_to_dwg",
]
