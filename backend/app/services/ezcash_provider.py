import json
import logging
import os
import time
import threading
import uuid
from dataclasses import dataclass
from typing import Optional

import urllib.request
import urllib.error

logger = logging.getLogger(__name__)

RELOADLY_AUTH_URL = "https://auth.reloadly.com/oauth/token"
RELOADLY_TOPUP_PROD = "https://topups.reloadly.com"
RELOADLY_TOPUP_SANDBOX = "https://topups-sandbox.reloadly.com"

SL_CARRIERS = {
    "dialog": {"name": "Dialog", "operator_id": "1348", "country_code": "LK"},
    "mobitel": {"name": "Mobitel", "operator_id": "1350", "country_code": "LK"},
    "hutch": {"name": "Hutch", "operator_id": "1349", "country_code": "LK"},
    "airtel": {"name": "Airtel", "operator_id": "1347", "country_code": "LK"},
}


@dataclass
class ProviderResponse:
    success: bool
    provider_reference: Optional[str] = None
    raw_response: Optional[str] = None
    failure_reason: Optional[str] = None
    operator_id: Optional[int] = None
    operator_name: Optional[str] = None
    delivered_amount: Optional[float] = None
    delivered_currency: Optional[str] = None


class EzCashProvider:
    def reload(
        self, phone: str, amount: float, reference: str, carrier: Optional[str] = None
    ) -> ProviderResponse:
        raise NotImplementedError

    def check_status(self, transaction_id: int) -> ProviderResponse:
        raise NotImplementedError


class SandboxProvider(EzCashProvider):
    def __init__(self):
        self._counter = 0
        self._lock = threading.Lock()

    def reload(
        self, phone: str, amount: float, reference: str, carrier: Optional[str] = None
    ) -> ProviderResponse:
        with self._lock:
            self._counter += 1
            count = self._counter
        time.sleep(0.3)
        provider_ref = f"SB-{uuid.uuid4().hex[:8].upper()}"
        carrier_info = SL_CARRIERS.get((carrier or "").lower())
        raw = json.dumps(
            {
                "mode": "sandbox",
                "phone": phone,
                "amount": amount,
                "reference": reference,
                "carrier": carrier or "auto-detect",
                "provider_ref": provider_ref,
            }
        )
        if count % 10 == 0:
            return ProviderResponse(
                success=False,
                raw_response=raw,
                failure_reason="Sandbox simulated failure",
            )
        return ProviderResponse(
            success=True,
            provider_reference=provider_ref,
            raw_response=raw,
            operator_id=int(carrier_info["operator_id"]) if carrier_info else None,
            operator_name=carrier_info["name"] if carrier_info else None,
            delivered_amount=amount,
            delivered_currency="LKR",
        )


class ReloadlyProvider(EzCashProvider):
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        sandbox: bool = False,
        timeout: int = 30,
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.sandbox = sandbox
        self.timeout = timeout
        self._token: Optional[str] = None
        self._token_expires: float = 0
        self._token_lock = threading.Lock()
        self._base_url = RELOADLY_TOPUP_SANDBOX if sandbox else RELOADLY_TOPUP_PROD
        self._auth_audience = (
            "https://topups-sandbox.reloadly.com"
            if sandbox
            else "https://topups.reloadly.com"
        )

    def _get_token(self) -> str:
        with self._token_lock:
            if self._token and time.time() < self._token_expires - 60:
                return self._token

            payload = json.dumps(
                {
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "grant_type": "client_credentials",
                    "audience": self._auth_audience,
                }
            ).encode()

            req = urllib.request.Request(
                RELOADLY_AUTH_URL,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    data = json.loads(resp.read().decode())
                    self._token = data["access_token"]
                    expires_in = data.get("expires_in", 86400)
                    self._token_expires = time.time() + expires_in
                    logger.info(
                        "Reloadly token acquired, expires in %ds", expires_in
                    )
                    return self._token
            except urllib.error.HTTPError as e:
                body = e.read().decode() if e.fp else ""
                logger.error("Reloadly auth failed: %s %s", e.code, body)
                raise RuntimeError(
                    f"Reloadly authentication failed (HTTP {e.code}): {body}"
                )
            except Exception as e:
                logger.error("Reloadly auth error: %s", e)
                raise RuntimeError(f"Reloadly authentication error: {e}")

    def _request(
        self, method: str, path: str, body: Optional[dict] = None
    ) -> dict:
        token = self._get_token()
        url = f"{self._base_url}{path}"
        data = json.dumps(body).encode() if body else None

        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
                "Accept": "application/com.reloadly.topups-v1+json",
            },
            method=method,
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            body_text = e.read().decode() if e.fp else ""
            logger.error("Reloadly API error %s %s: %s", method, path, body_text)
            try:
                error_data = json.loads(body_text)
            except (json.JSONDecodeError, ValueError):
                error_data = {"message": body_text or f"HTTP {e.code}"}
            raise ReloadlyAPIError(e.code, error_data)

    def _resolve_operator(self, phone: str, carrier: Optional[str] = None) -> dict:
        if carrier:
            key = carrier.lower().strip()
            if key in SL_CARRIERS:
                info = SL_CARRIERS[key]
                return {
                    "operator_id": info["operator_id"],
                    "country_code": info["country_code"],
                    "name": info["name"],
                }

        try:
            digits_only = phone.lstrip("+").replace(" ", "")
            result = self._request(
                "GET",
                f"/operators/auto-detect/phone/{digits_only}/countries/LK",
            )
            if result:
                return {
                    "operator_id": str(result.get("operatorId", "")),
                    "country_code": result.get("countryCode", "LK"),
                    "name": result.get("name", "Unknown"),
                }
        except Exception as e:
            logger.warning("Auto-detect failed for %s: %s", phone, e)

        return {
            "operator_id": SL_CARRIERS["dialog"]["operator_id"],
            "country_code": "LK",
            "name": "Dialog",
        }

    def reload(
        self, phone: str, amount: float, reference: str, carrier: Optional[str] = None
    ) -> ProviderResponse:
        op = self._resolve_operator(phone, carrier)
        digits_only = phone.lstrip("+").replace(" ", "")

        payload = {
            "operatorId": op["operator_id"],
            "amount": str(round(amount, 2)),
            "useLocalAmount": True,
            "customIdentifier": reference,
            "recipientPhone": {
                "countryCode": op["country_code"],
                "number": digits_only,
            },
        }

        try:
            result = self._request("POST", "/topups", payload)
        except ReloadlyAPIError as e:
            return ProviderResponse(
                success=False,
                raw_response=json.dumps(e.error_data),
                failure_reason=e.error_data.get("message", f"HTTP {e.status_code}"),
            )
        except Exception as e:
            return ProviderResponse(
                success=False,
                failure_reason=str(e),
            )

        status = (result.get("status") or "").upper()
        tx_id = result.get("transactionId")

        if status in ("SUCCESSFUL", "SUCCESS", "COMPLETED"):
            return ProviderResponse(
                success=True,
                provider_reference=str(tx_id) if tx_id else None,
                raw_response=json.dumps(result),
                operator_id=result.get("operatorId"),
                operator_name=result.get("operatorName"),
                delivered_amount=result.get("deliveredAmount"),
                delivered_currency=result.get("deliveredAmountCurrencyCode"),
            )

        if status == "PENDING":
            return ProviderResponse(
                success=True,
                provider_reference=str(tx_id) if tx_id else None,
                raw_response=json.dumps(result),
                operator_id=result.get("operatorId"),
                operator_name=result.get("operatorName"),
            )

        return ProviderResponse(
            success=False,
            provider_reference=str(tx_id) if tx_id else None,
            raw_response=json.dumps(result),
            failure_reason=result.get("message", f"Reloadly status: {status}"),
            operator_id=result.get("operatorId"),
            operator_name=result.get("operatorName"),
        )

    def check_status(self, transaction_id: int) -> ProviderResponse:
        try:
            result = self._request("GET", f"/topups/{transaction_id}/status")
        except ReloadlyAPIError as e:
            return ProviderResponse(
                success=False,
                raw_response=json.dumps(e.error_data),
                failure_reason=e.error_data.get("message", f"HTTP {e.status_code}"),
            )
        except Exception as e:
            return ProviderResponse(
                success=False,
                failure_reason=str(e),
            )

        status = (result.get("status") or "").upper()
        if status in ("SUCCESSFUL", "SUCCESS", "COMPLETED"):
            return ProviderResponse(
                success=True,
                provider_reference=str(transaction_id),
                raw_response=json.dumps(result),
                operator_id=result.get("operatorId"),
                operator_name=result.get("operatorName"),
                delivered_amount=result.get("deliveredAmount"),
                delivered_currency=result.get("deliveredAmountCurrencyCode"),
            )
        return ProviderResponse(
            success=False,
            provider_reference=str(transaction_id),
            raw_response=json.dumps(result),
            failure_reason=result.get("message", f"Status: {status}"),
        )


class ReloadlyAPIError(Exception):
    def __init__(self, status_code: int, error_data: dict):
        self.status_code = status_code
        self.error_data = error_data
        super().__init__(f"Reloadly API error {status_code}: {error_data}")


def get_provider(settings: Optional[dict] = None) -> EzCashProvider:
    cfg = settings or {}
    sandbox = (
        cfg.get("ezcash_sandbox", os.getenv("EZCASH_SANDBOX", "true"))
    ).lower() == "true"
    client_id = cfg.get("ezcash_client_id") or os.getenv("EZCASH_CLIENT_ID", "")
    client_secret = cfg.get("ezcash_client_secret") or os.getenv("EZCASH_CLIENT_SECRET", "")
    timeout = int(cfg.get("ezcash_timeout") or os.getenv("EZCASH_TIMEOUT", "30"))

    if sandbox and not client_id:
        return SandboxProvider()

    if not client_id or not client_secret:
        logger.warning(
            "Reloadly credentials not configured, falling back to sandbox"
        )
        return SandboxProvider()

    return ReloadlyProvider(
        client_id=client_id,
        client_secret=client_secret,
        sandbox=sandbox,
        timeout=timeout,
    )
