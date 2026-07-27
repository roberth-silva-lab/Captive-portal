from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, health, public
from app.api.middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.integrations.unifi import unifi_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    yield
    await unifi_client.close()


def create_app() -> FastAPI:
    settings = get_settings()
    docs_url = None if settings.is_production else "/docs"
    app = FastAPI(title="Captive Portal", debug=settings.debug, docs_url=docs_url, redoc_url=None, lifespan=lifespan)
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
    app.include_router(admin.router)
    return app


app = create_app()
