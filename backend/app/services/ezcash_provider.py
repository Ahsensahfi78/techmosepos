import json
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ProviderResponse:
    success: bool
    provider_reference: Optional[str] = None
    raw_response: Optional[str] = None
    failure_reason: Optional[str] = None


class EzCashProvider:
    def reload(
        self, phone: str, amount: float, reference: str
    ) -> ProviderResponse:
        raise NotImplementedError


class SandboxProvider(EzCashProvider):
    def __init__(self):
        self._counter = 0

    def reload(
        self, phone: str, amount: float, reference: str
    ) -> ProviderResponse:
        self._counter += 1
        time.sleep(0.3)
        provider_ref = f"SB-{uuid.uuid4().hex[:8].upper()}"
        raw = json.dumps(
            {
                "mode": "sandbox",
                "phone": phone,
                "amount": amount,
                "reference": reference,
                "provider_ref": provider_ref,
            }
        )
        if self._counter % 10 == 0:
            return ProviderResponse(
                success=False,
                raw_response=raw,
                failure_reason="Sandbox simulated timeout",
            )
        return ProviderResponse(
            success=True,
            provider_reference=provider_ref,
            raw_response=raw,
        )


class LiveProvider(EzCashProvider):
    def __init__(self, api_url: str, api_key: str, api_secret: str, timeout: int):
        self.api_url = api_url
        self.api_key = api_key
        self.api_secret = api_secret
        self.timeout = timeout

    def reload(
        self, phone: str, amount: float, reference: str
    ) -> ProviderResponse:
        if not self.api_url:
            return ProviderResponse(
                success=False,
                failure_reason="Live provider API URL not configured",
            )
        import urllib.request
        import urllib.error

        payload = json.dumps(
            {
                "phone": phone,
                "amount": amount,
                "reference": reference,
            }
        ).encode()
        req = urllib.request.Request(
            self.api_url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
                "X-API-Secret": self.api_secret,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = resp.read().decode()
                data = json.loads(body)
                return ProviderResponse(
                    success=data.get("success", False),
                    provider_reference=data.get("provider_reference"),
                    raw_response=body,
                    failure_reason=data.get("failure_reason"),
                )
        except urllib.error.HTTPError as e:
            body = e.read().decode() if e.fp else ""
            return ProviderResponse(
                success=False,
                raw_response=body,
                failure_reason=f"HTTP {e.code}: {e.reason}",
            )
        except Exception as e:
            return ProviderResponse(
                success=False,
                failure_reason=str(e),
            )


def get_provider() -> EzCashProvider:
    sandbox = os.getenv("EZCASH_SANDBOX", "true").lower() == "true"
    if sandbox:
        return SandboxProvider()
    return LiveProvider(
        api_url=os.getenv("EZCASH_API_URL", ""),
        api_key=os.getenv("EZCASH_API_KEY", ""),
        api_secret=os.getenv("EZCASH_API_SECRET", ""),
        timeout=int(os.getenv("EZCASH_TIMEOUT", "30")),
    )
