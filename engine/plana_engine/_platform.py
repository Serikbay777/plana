"""Small platform compatibility helpers."""

from __future__ import annotations

import platform
import sys


def avoid_windows_wmi_platform_probe() -> None:
    """Avoid a slow or stuck WMI probe in `platform.system()` on Windows.

    Python 3.12 can ask WMI for Windows version details inside `platform.uname`.
    In locked-down desktop environments that call may hang. `ezdxf` imports call
    `platform.system()` while initialising font support, so cache the only value
    it needs before importing `ezdxf`.
    """
    if not sys.platform.startswith("win"):
        return
    if getattr(platform, "_uname_cache", None) is not None:
        return
    platform._uname_cache = platform.uname_result("Windows", "", "", "", "")  # type: ignore[attr-defined]


__all__ = ["avoid_windows_wmi_platform_probe"]
