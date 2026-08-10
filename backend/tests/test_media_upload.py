from io import BytesIO
from pathlib import Path
from uuid import uuid4

import pytest
from PIL import Image

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models import MediaAsset


def login_admin(client) -> str:
    response = client.post("/api/admin/login", json={"email": "admin@example.com", "password": "StrongPassword123!"})
    assert response.status_code == 200
    return client.cookies.get("portal_csrf") or ""


def png_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (12, 8), "#176b87").save(buffer, format="PNG")
    return buffer.getvalue()


def configure_media(monkeypatch, media_dir, *, max_logo_bytes=2097152):
    monkeypatch.setenv("MEDIA_STORAGE_PATH", str(media_dir))
    monkeypatch.setenv("MEDIA_PUBLIC_BASE_URL", "/media")
    monkeypatch.setenv("MEDIA_MAX_LOGO_BYTES", str(max_logo_bytes))
    monkeypatch.setenv("MEDIA_MAX_IMAGE_BYTES", "5242880")
    get_settings.cache_clear()


@pytest.fixture
def media_dir():
    path = Path(".test-media") / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    yield path
    for item in sorted(path.glob("*")):
        item.unlink()
    path.rmdir()
    parent = path.parent
    if parent.exists() and not any(parent.iterdir()):
        parent.rmdir()


def test_admin_uploads_publicly_reads_and_deletes_image(client, admin_user, monkeypatch, media_dir):
    configure_media(monkeypatch, media_dir)
    csrf = login_admin(client)

    uploaded = client.post(
        "/api/admin/media",
        headers={"X-CSRF-Token": csrf},
        data={"assetType": "logo"},
        files={"file": ("logo.png", png_bytes(), "image/png")},
    )

    assert uploaded.status_code == 200
    payload = uploaded.json()
    assert payload["assetType"] == "logo"
    assert payload["contentType"] == "image/png"
    assert payload["width"] == 12
    assert payload["height"] == 8
    assert payload["publicUrl"].startswith("/media/")
    assert (media_dir / f"{payload['id']}.png").exists()

    public = client.get(payload["publicUrl"])
    assert public.status_code == 200
    assert public.headers["content-type"].startswith("image/png")

    deleted = client.delete(f"/api/admin/media/{payload['id']}", headers={"X-CSRF-Token": csrf})
    assert deleted.status_code == 200
    assert not (media_dir / f"{payload['id']}.png").exists()

    missing = client.get(payload["publicUrl"])
    assert missing.status_code == 404

    db = SessionLocal()
    row = db.get(MediaAsset, payload["id"])
    assert row is not None
    assert row.deleted_at is not None
    db.close()


def test_admin_media_upload_rejects_svg(client, admin_user, monkeypatch, media_dir):
    configure_media(monkeypatch, media_dir)
    csrf = login_admin(client)
    response = client.post(
        "/api/admin/media",
        headers={"X-CSRF-Token": csrf},
        data={"assetType": "logo"},
        files={"file": ("logo.svg", b"<svg></svg>", "image/svg+xml")},
    )
    assert response.status_code == 422


def test_admin_media_upload_rejects_corrupt_image(client, admin_user, monkeypatch, media_dir):
    configure_media(monkeypatch, media_dir)
    csrf = login_admin(client)
    response = client.post(
        "/api/admin/media",
        headers={"X-CSRF-Token": csrf},
        data={"assetType": "maintenance"},
        files={"file": ("broken.png", b"not an image", "image/png")},
    )
    assert response.status_code == 422


def test_admin_media_upload_rejects_large_file(client, admin_user, monkeypatch, media_dir):
    configure_media(monkeypatch, media_dir, max_logo_bytes=8)
    csrf = login_admin(client)
    response = client.post(
        "/api/admin/media",
        headers={"X-CSRF-Token": csrf},
        data={"assetType": "logo"},
        files={"file": ("logo.png", png_bytes(), "image/png")},
    )
    assert response.status_code == 413


def test_admin_media_upload_reports_storage_permission_error(client, admin_user, monkeypatch, media_dir):
    configure_media(monkeypatch, media_dir)
    csrf = login_admin(client)

    def deny_write(self, data):
        raise PermissionError("permission denied")

    monkeypatch.setattr(Path, "write_bytes", deny_write)
    response = client.post(
        "/api/admin/media",
        headers={"X-CSRF-Token": csrf},
        data={"assetType": "maintenance"},
        files={"file": ("maintenance.png", png_bytes(), "image/png")},
    )

    assert response.status_code == 503
    assert "sem permissão de escrita" in response.json()["detail"]
