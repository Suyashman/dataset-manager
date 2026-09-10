"""Pass-through proxy to the standalone SAM3 auto-labeler.

Deliberately thin. The sidecar owns all SAM3 state -- the run directory, the loaded model, the
annotation subprocess -- and this app owns none of it. Proxying rather than reimplementing keeps
transformers/torch out of this venv entirely, which is what lets Dataset Manager keep running on
CPU-only laptops.

Requests go through the app's own origin so the sidecar needs no CORS changes, and so an
unreachable sidecar surfaces as one predictable error shape instead of an opaque browser failure.
"""
import httpx

from app.services import settings_service
from app.utils.errors import AppError, Sam3UnreachableError

# Long enough for the slow-but-bounded endpoints (/api/refine runs model inference,
# /api/export shells out to sam3_export.py), short on connect because "not running" is a
# normal answer and the UI should hear it immediately rather than hang.
_CONNECT_TIMEOUT = 2.0
_READ_TIMEOUT = 180.0


def sidecar_url() -> str:
    return settings_service.load_settings().sam3_sidecar_url.rstrip("/")


async def forward(
    method: str,
    path: str,
    *,
    params: dict | None = None,
    json_body: dict | None = None,
) -> httpx.Response:
    """Forward one request to the sidecar and hand back its raw response.

    Connection failures become Sam3UnreachableError. Everything else -- including the sidecar's
    own 4xx/5xx -- is returned as-is so its error messages reach the user unmodified.
    """
    base = sidecar_url()
    timeout = httpx.Timeout(_READ_TIMEOUT, connect=_CONNECT_TIMEOUT)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            return await client.request(method, f"{base}{path}", params=params, json=json_body)
    except (httpx.ConnectError, httpx.ConnectTimeout):
        raise Sam3UnreachableError(
            "SAM3 is not running. Start sam3_server.py on a machine with a CUDA GPU, "
            "then check the sidecar URL in Settings.",
            details={"sidecar_url": base},
        )
    except httpx.HTTPError as e:
        raise AppError(f"SAM3 request failed: {type(e).__name__}: {e}", details={"sidecar_url": base})
