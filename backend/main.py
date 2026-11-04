"""Root entrypoint alias for convenience.

Allows cashiers/developers to run `uvicorn main:app` directly from the `backend/` folder
as well as `uvicorn app.main:app`.
"""

from app.main import app

__all__ = ["app"]
