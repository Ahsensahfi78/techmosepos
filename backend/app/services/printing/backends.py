"""Printer backends.

The application must never *pretend* a printer is healthy, so the backend
contract is deliberately narrow:

* ``detect``  – read-only discovery + health signals from the OS
* ``submit``  – push one job through the operating system's print subsystem
* ``jobs``    – read back spooler job state

Three implementations exist:

``WindowsPrinterBackend``
    Real Windows implementation (PowerShell + the Windows print APIs).  Only
    ever reports facts it actually read back from the OS.
``MockPrinterBackend``
    In-memory fake used by the unit/integration test suite.
``UnsupportedPrinterBackend``
    Returned on platforms where no print API is available.  It reports
    ``supported = False`` instead of inventing results.
"""

from __future__ import annotations

import abc
import json
import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

SCRIPTS_DIR = Path(__file__).resolve().parent / "scripts"

DEFAULT_DETECT_TIMEOUT = 25.0
DEFAULT_SUBMIT_TIMEOUT = 45.0


class PrinterBackendError(RuntimeError):
    """Raised when the OS print subsystem could not be queried or used."""


@dataclass
class PrinterRecord:
    name: str
    driver: str | None = None
    port: str | None = None
    type: str | None = None
    queue_status: str | None = None
    shared: bool = False
    is_default: bool = False
    work_offline: bool = False
    detected_error: int = -1
    job_count: int = 0
    attributes: int = 0
    print_processor: str | None = None
    location: str | None = None
    comment: str | None = None
    connection: dict[str, Any] = field(default_factory=dict)
    capabilities: dict[str, Any] = field(default_factory=dict)


@dataclass
class UnboundDevice:
    instance_id: str
    description: str | None = None
    status: str | None = None
    present: bool | None = None
    usb_vid: str | None = None
    usb_pid: str | None = None
    has_queue: bool = False


@dataclass
class DetectionResult:
    supported: bool
    platform: str = "unknown"
    computer: str | None = None
    ps_version: str | None = None
    spooler_status: str | None = None
    spooler_start_type: str | None = None
    default_printer: str | None = None
    printers: list[PrinterRecord] = field(default_factory=list)
    unbound_devices: list[UnboundDevice] = field(default_factory=list)
    error: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class SubmitResult:
    ok: bool
    printer: str
    job_id: int | None = None
    status: str = "NotSubmitted"
    error: str | None = None
    jobs_before: list[int] = field(default_factory=list)
    jobs_after: list[int] = field(default_factory=list)
    elapsed_ms: int = 0
    page_width_100in: int | None = None
    page_height_100in: int | None = None

    @property
    def submitted(self) -> bool:
        """The OS accepted the job into the spooler."""
        return self.ok and self.status not in {"NotSubmitted", "Rejected", "Failed"}

    @property
    def completed(self) -> bool:
        """The spooler reported the job as finished."""
        return self.status in {
            "Printed",
            "CompletedUntracked",
            "Printed,Deleted",
            "Retained",
        }


class PrinterBackend(abc.ABC):
    name: str = "abstract"
    supported: bool = False

    @property
    def reason(self) -> str | None:  # pragma: no cover - trivial
        return None

    @abc.abstractmethod
    def detect(self, timeout: float = DEFAULT_DETECT_TIMEOUT) -> DetectionResult:
        """Read-only discovery. Must never modify system state."""

    @abc.abstractmethod
    def submit(
        self,
        printer: str,
        layout: dict[str, Any],
        *,
        wait_seconds: float = 0.0,
        timeout: float = DEFAULT_SUBMIT_TIMEOUT,
    ) -> SubmitResult:
        """Push one test document through the OS print subsystem."""

    @abc.abstractmethod
    def jobs(self, printer: str, timeout: float = 15.0) -> list[dict[str, Any]]:
        """List spooler jobs currently queued for ``printer``."""


# ---------------------------------------------------------------------------
# Unsupported
# ---------------------------------------------------------------------------


class UnsupportedPrinterBackend(PrinterBackend):
    name = "unsupported"
    supported = False

    def __init__(self, reason: str) -> None:
        self._reason = reason

    @property
    def reason(self) -> str | None:
        return self._reason

    def detect(self, timeout: float = DEFAULT_DETECT_TIMEOUT) -> DetectionResult:
        return DetectionResult(supported=False, error=self._reason)

    def submit(
        self,
        printer: str,
        layout: dict[str, Any],
        *,
        wait_seconds: float = 0.0,
        timeout: float = DEFAULT_SUBMIT_TIMEOUT,
    ) -> SubmitResult:
        raise PrinterBackendError(self._reason)

    def jobs(self, printer: str, timeout: float = 15.0) -> list[dict[str, Any]]:
        raise PrinterBackendError(self._reason)


# ---------------------------------------------------------------------------
# Mock (test double)
# ---------------------------------------------------------------------------


def make_printer(
    name: str,
    *,
    driver: str = "Test Driver 1.0",
    port: str = "USB001",
    present: bool = True,
    device_status: str | None = None,
    work_offline: bool = False,
    queue_status: str = "Normal",
    kind: str = "usb",
    is_default: bool = False,
    paper_sizes: Iterable[dict[str, Any]] | None = None,
    config: dict[str, Any] | None = None,
    job_count: int = 0,
) -> PrinterRecord:
    if device_status is None:
        device_status = "OK" if present else "Unknown"
    return PrinterRecord(
        name=name,
        driver=driver,
        port=port,
        type="Local",
        queue_status=queue_status,
        is_default=is_default,
        work_offline=work_offline,
        job_count=job_count,
        connection={
            "kind": kind,
            "port_monitor": "Dynamic Print Monitor" if kind == "usb" else None,
            "device_present": present if kind == "usb" else None,
            "device_status": device_status if kind == "usb" else "NotApplicable",
            "device_name": name if present else None,
            "device_id": f"USBPRINT\\{name.upper()}\\TEST&0&{port}" if present else None,
        },
        capabilities={
            "is_valid": True,
            "can_print": not work_offline,
            "is_offline": work_offline,
            "duplex": "Simplex",
            "color": False,
            "copies": 1,
            "resolutions": [{"kind": "DotsPerInch", "x": 203, "y": 203}],
            "paper_sizes": list(paper_sizes or []),
            "default_paper": None,
            "config": config or {
                "duplex": "Default",
                "orientation": "Portrait",
                "media_size": 0,
                "color": False,
                "copy_count": 1,
                "fit_to_page": False,
                "pages_sheet": 1,
            },
        },
    )


class MockPrinterBackend(PrinterBackend):
    """Deterministic fake used by the automated test suite.

    Tests mutate the exposed state directly (``printers``, ``submit_error``,
    ``job_status``, ...) to simulate every hardware scenario in the QA plan.
    """

    name = "mock"
    supported = True

    def __init__(
        self,
        printers: Iterable[PrinterRecord] = (),
        *,
        spooler_status: str = "Running",
        spooler_start_type: str = "Automatic",
        default_printer: str | None = None,
        unbound: Iterable[UnboundDevice] = (),
        platform: str = "windows(mock)",
    ) -> None:
        self.printers: dict[str, PrinterRecord] = {p.name: p for p in printers}
        self.spooler_status = spooler_status
        self.spooler_start_type = spooler_start_type
        self.default_printer = default_printer
        self.unbound: list[UnboundDevice] = list(unbound)
        self.platform = platform

        # Behaviour knobs -------------------------------------------------
        self.detect_error: str | None = None
        self.submit_error: str | None = None
        self.reject_printer: str | None = None
        self.job_status: str = "Printed"
        self.submits: list[dict[str, Any]] = []
        self._next_job_id = 1000
        self.jobs_by_printer: dict[str, list[dict[str, Any]]] = {}

    # -- helpers ---------------------------------------------------------
    def add(self, printer: PrinterRecord) -> PrinterRecord:
        self.printers[printer.name] = printer
        return printer

    def remove(self, name: str) -> None:
        self.printers.pop(name, None)

    def get(self, name: str) -> PrinterRecord | None:
        return self.printers.get(name)

    # -- PrinterBackend ---------------------------------------------------
    def detect(self, timeout: float = DEFAULT_DETECT_TIMEOUT) -> DetectionResult:
        if self.detect_error:
            return DetectionResult(supported=True, platform=self.platform, error=self.detect_error)
        return DetectionResult(
            supported=True,
            platform=self.platform,
            computer="MOCK-POS",
            ps_version="mock",
            spooler_status=self.spooler_status,
            spooler_start_type=self.spooler_start_type,
            default_printer=self.default_printer,
            printers=list(self.printers.values()),
            unbound_devices=list(self.unbound),
        )

    def submit(
        self,
        printer: str,
        layout: dict[str, Any],
        *,
        wait_seconds: float = 0.0,
        timeout: float = DEFAULT_SUBMIT_TIMEOUT,
    ) -> SubmitResult:
        record = self.printers.get(printer)
        if self.reject_printer == printer:
            return SubmitResult(
                ok=False,
                printer=printer,
                status="Rejected",
                error=f"Printer '{printer}' is not available to Windows",
            )
        if self.submit_error:
            return SubmitResult(
                ok=False,
                printer=printer,
                status="Failed",
                error=self.submit_error,
            )
        if record is None:
            return SubmitResult(
                ok=False,
                printer=printer,
                status="Rejected",
                error=f"Printer '{printer}' is not available to Windows",
            )

        job_id = self._next_job_id
        self._next_job_id += 1
        self.submits.append({"printer": printer, "layout": layout, "job_id": job_id})
        job = {"id": job_id, "status": self.job_status, "printer": printer}
        self.jobs_by_printer.setdefault(printer, []).append(job)
        record.job_count = len(self.jobs_by_printer[printer])
        return SubmitResult(
            ok=True,
            printer=printer,
            job_id=job_id,
            status="Submitted" if wait_seconds else "Submitted",
            jobs_before=[],
            jobs_after=[job_id],
            elapsed_ms=1,
        )

    def jobs(self, printer: str, timeout: float = 15.0) -> list[dict[str, Any]]:
        return list(self.jobs_by_printer.get(printer, []))


# ---------------------------------------------------------------------------
# Windows
# ---------------------------------------------------------------------------


def _decode(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


class WindowsPrinterBackend(PrinterBackend):
    """Real implementation backed by the Windows print subsystem."""

    name = "windows"
    supported = True

    def __init__(
        self,
        scripts_dir: Path | None = None,
        *,
        executable: str | None = None,
        detect_timeout: float = DEFAULT_DETECT_TIMEOUT,
        submit_timeout: float = DEFAULT_SUBMIT_TIMEOUT,
    ) -> None:
        self.scripts_dir = Path(scripts_dir or SCRIPTS_DIR)
        self.executable = executable or self._find_powershell()
        self.detect_timeout = detect_timeout
        self.submit_timeout = submit_timeout

    @staticmethod
    def _find_powershell() -> str | None:
        for candidate in (
            os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
            shutil.which("powershell.exe"),
            shutil.which("powershell"),
        ):
            if candidate and Path(candidate).exists():
                return candidate
        return None

    @property
    def available(self) -> bool:
        return bool(self.executable)

    @property
    def reason(self) -> str | None:
        if self.executable:
            return None
        return "Windows PowerShell was not found on this machine"

    def _run(
        self,
        script: str,
        extra: list[str],
        timeout: float,
        *,
        outfile: Path | None = None,
    ) -> dict[str, Any]:
        if not self.executable:
            raise PrinterBackendError(self.reason or "PowerShell unavailable")

        path = self.scripts_dir / script
        if not path.exists():
            raise PrinterBackendError(f"Missing helper script: {path}")

        handle = None
        if outfile is None:
            handle = tempfile.NamedTemporaryFile(
                mode="w", suffix=".json", delete=False, encoding="utf-8"
            )
            outfile = Path(handle.name)
            handle.close()

        cmd = [
            self.executable,
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(path),
            *extra,
            "-OutFile",
            str(outfile),
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=timeout,
                cwd=str(self.scripts_dir.parent.parent.parent),
            )
        except subprocess.TimeoutExpired as exc:
            raise PrinterBackendError(
                f"{script} did not finish within {timeout:g}s"
            ) from exc

        payload = ""
        try:
            if outfile.exists():
                payload = outfile.read_text(encoding="utf-8-sig", errors="replace").strip()
        finally:
            if handle is not None:
                try:
                    outfile.unlink()
                except OSError:
                    pass

        if not payload:
            stderr = _decode(proc.stderr or b"").strip()
            raise PrinterBackendError(
                f"{script} produced no output (exit {proc.returncode})"
                + (f": {stderr}" if stderr else "")
            )

        try:
            data = json.loads(payload)
        except ValueError as exc:
            raise PrinterBackendError(f"{script} returned invalid JSON") from exc
        if not isinstance(data, dict):
            raise PrinterBackendError(f"{script} returned unexpected JSON")
        data["_exit_code"] = proc.returncode
        return data

    # -- PrinterBackend ---------------------------------------------------
    def detect(self, timeout: float = DEFAULT_DETECT_TIMEOUT) -> DetectionResult:
        try:
            data = self._run("detect.ps1", [], timeout)
        except PrinterBackendError as exc:
            return DetectionResult(supported=True, error=str(exc))

        spooler = data.get("spooler") or {}
        printers = [
            PrinterRecord(
                name=p.get("name") or "",
                driver=p.get("driver"),
                port=p.get("port"),
                type=p.get("type"),
                queue_status=p.get("queue_status"),
                shared=bool(p.get("shared")),
                is_default=bool(p.get("is_default")),
                work_offline=bool(p.get("work_offline")),
                detected_error=int(p.get("detected_error", -1)),
                job_count=int(p.get("job_count") or 0),
                attributes=int(p.get("attributes") or 0),
                print_processor=p.get("print_processor"),
                location=p.get("location"),
                comment=p.get("comment"),
                connection=dict(p.get("connection") or {}),
                capabilities=dict(p.get("capabilities") or {}),
            )
            for p in (data.get("printers") or [])
            if p.get("name")
        ]
        unbound = [
            UnboundDevice(
                instance_id=u.get("instance_id") or "",
                description=u.get("description"),
                status=u.get("status"),
                present=u.get("present"),
                usb_vid=u.get("usb_vid"),
                usb_pid=u.get("usb_pid"),
                has_queue=bool(u.get("has_queue")),
            )
            for u in (data.get("unbound") or [])
        ]
        return DetectionResult(
            supported=True,
            platform=data.get("platform", "windows"),
            computer=data.get("computer"),
            ps_version=data.get("ps_version"),
            spooler_status=spooler.get("status"),
            spooler_start_type=spooler.get("start_type"),
            default_printer=data.get("default_name"),
            printers=printers,
            unbound_devices=unbound,
            error=data.get("error"),
            raw={k: v for k, v in data.items() if k not in {"printers", "unbound"}},
        )

    def submit(
        self,
        printer: str,
        layout: dict[str, Any],
        *,
        wait_seconds: float = 0.0,
        timeout: float | None = None,
    ) -> SubmitResult:
        payload = dict(layout)
        payload["printer"] = printer

        handle = tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        )
        layout_path = Path(handle.name)
        handle.write(json.dumps(payload))
        handle.close()

        fd, out_path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        outfile = Path(out_path)
        try:
            data = self._run(
                "print.ps1",
                ["-LayoutPath", str(layout_path), "-WaitSeconds", str(int(wait_seconds))],
                timeout or self.submit_timeout,
                outfile=outfile,
            )
        except PrinterBackendError as exc:
            return SubmitResult(ok=False, printer=printer, status="Failed", error=str(exc))
        finally:
            for path in (layout_path, outfile):
                try:
                    path.unlink()
                except OSError:
                    pass

        result = SubmitResult(
            ok=bool(data.get("ok")),
            printer=printer,
            job_id=data.get("job_id"),
            status=data.get("status") or "Unknown",
            error=data.get("error"),
            jobs_before=list(data.get("jobs_before") or []),
            jobs_after=list(data.get("jobs_after") or []),
            elapsed_ms=int(data.get("elapsed_ms") or 0),
            page_width_100in=data.get("page_width_in100"),
            page_height_100in=data.get("page_height_in100"),
        )
        return result

    def jobs(self, printer: str, timeout: float = 15.0) -> list[dict[str, Any]]:
        try:
            data = self._run("jobs.ps1", ["-PrinterName", printer], timeout)
        except PrinterBackendError as exc:
            raise PrinterBackendError(str(exc)) from exc
        return list(data.get("jobs") or [])


def wait_for(predicate, *, timeout: float, interval: float = 0.4) -> bool:
    """Poll ``predicate`` until true or ``timeout`` elapses."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()
