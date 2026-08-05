import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import admin, health, public
from app.api.middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.integrations.unifi import unifi_client
from app.services.session_expirer import session_expirer_loop


def _safe_validation_errors(exc: RequestValidationError) -> list[dict[str, str]]:
    safe_errors: list[dict[str, str]] = []
    for error in exc.errors():
        loc = error.get("loc", [])
        field = str(loc[-1]) if loc else "field"
        safe_errors.append({"field": field, "message": str(error.get("msg", "Valor invalido."))})
    return safe_errors


async def validation_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):
        raise exc
    return JSONResponse(status_code=422, content={"detail": _safe_validation_errors(exc)})


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings = get_settings()
    stop_expirer = asyncio.Event()
    expirer_task: asyncio.Task | None = None
    if settings.session_expirer_enabled:
        expirer_task = asyncio.create_task(
            session_expirer_loop(
                stop_event=stop_expirer,
                interval_seconds=settings.session_expirer_interval_seconds,
                batch_size=settings.session_expirer_batch_size,
            )
        )
    try:
        yield
    finally:
        stop_expirer.set()
        if expirer_task:
            expirer_task.cancel()
            try:
                await expirer_task
            except asyncio.CancelledError:
                pass
        await unifi_client.close()


def create_app() -> FastAPI:
    settings = get_settings()
    docs_url = None if settings.is_production else "/docs"
    app = FastAPI(title="Captive Portal", debug=settings.debug, docs_url=docs_url, redoc_url=None, lifespan=lifespan)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Content-Type", "X-CSRF-Token"],
        )
    app.include_router(health.router)
    app.include_router(public.router)
    app.include_router(public.media_router)
    app.include_router(admin.router)
    return app


app = create_app()
