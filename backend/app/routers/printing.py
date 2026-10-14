"""Raw printing — send bytes to a print queue without a driver.

Nothing here touches the database: printing is a device operation, not state,
and a spooler failure must never roll anything back. Every endpoint is guarded
by ``barcode.print`` because whoever can print a label can already make the
device produce paper.
"""

from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..permissions import require_permission
from ..services.printing.backends import (
    DetectionResult,
    PrinterBackendError,
    RawSubmitResult,
    get_backend,
)

router = APIRouter(prefix="/printing", tags=["printing"])

# A label job is a few kilobytes. This is a sanity ceiling, not a limit —
# anything larger is a mistake upstream, not a real print request.
MAX_RAW_BYTES = 256 * 1024


class RawPrintRequest(BaseModel):
    printer: str = Field(min_length=1, max_length=256)
    data_b64: str = Field(min_length=1)


def _detection_payload(result: DetectionResult) -> dict:
    return {
        "supported": result.supported,
        "platform": result.platform,
        "computer": result.computer,
        "spooler_status": result.spooler_status,
        "default_printer": result.default_printer,
        "error": result.error,
        "printers": [
            {
                "name": p.name,
                "driver": p.driver,
                "port": p.port,
                "type": p.type,
                "queue_status": p.queue_status,
                "is_default": p.is_default,
                "work_offline": p.work_offline,
                "job_count": p.job_count,
            }
            for p in result.printers
        ],
    }


def _raw_payload(result: RawSubmitResult) -> dict:
    return {
        "ok": result.ok,
        "printer": result.printer,
        "bytes_sent": result.bytes_sent,
        "bytes_written": result.bytes_written,
        "error": result.error,
        "waited_ms": result.waited_ms,
    }


@router.get("/printers")
def list_printers(
    _user=Depends(require_permission("barcode.print")),
) -> dict:
    """Read-only discovery of the queues on this machine."""
    backend = get_backend()
    try:
        result = backend.detect()
    except PrinterBackendError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    return _detection_payload(result)


@router.post("/raw")
def print_raw(
    payload: RawPrintRequest,
    _user=Depends(require_permission("barcode.print")),
) -> dict:
    """Write a pre-built job (TSPL) straight to the queue as RAW data.

    The driver never sees these bytes, so it cannot rewrite the DEVMODE or
    rescale the page — the printer's own gap sensing and media size apply.
    """
    try:
        data = base64.b64decode(payload.data_b64, validate=True)
    except Exception as exc:  # noqa: BLE001 - malformed input, not a fault
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"data_b64 is not valid base64: {exc}",
        )

    if not data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="payload is empty",
        )
    if len(data) > MAX_RAW_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"payload exceeds {MAX_RAW_BYTES} bytes",
        )

    backend = get_backend()
    if not backend.supported:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=backend.reason or "raw printing is not available on this host",
        )

    try:
        result = backend.submit_raw(payload.printer, data)
    except PrinterBackendError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    if not result.ok:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=result.error or "the print queue rejected the job",
        )
    return _raw_payload(result)
