from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Protocol

from fastapi import HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError

from app.core.config import Settings
from app.models.entities import new_id

Image.MAX_IMAGE_PIXELS = 20_000_000

ALLOWED_IMAGE_FORMATS = {
    "PNG": ("image/png", ".png"),
    "JPEG": ("image/jpeg", ".jpg"),
    "WEBP": ("image/webp", ".webp"),
}
ASSET_LIMIT_KIND = {"logo": "logo", "portal_background": "image", "maintenance": "image", "notice": "image"}


@dataclass(frozen=True)
class StoredMedia:
    id: str
    asset_type: str
    original_filename: str
    stored_filename: str
    content_type: str
    byte_size: int
    width: int
    height: int
    public_url: str
    path: Path


class MediaStorage(Protocol):
    async def store_upload(self, upload: UploadFile, *, asset_type: str) -> StoredMedia: ...
    def public_path(self, stored_filename: str) -> Path: ...
    def delete(self, stored_filename: str) -> None: ...


class LocalMediaStorage:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.root = Path(settings.media_storage_path).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    async def store_upload(self, upload: UploadFile, *, asset_type: str) -> StoredMedia:
        normalized_type = asset_type.strip().lower()
        if normalized_type not in ASSET_LIMIT_KIND:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Tipo de imagem inválido.")
        limit = self.settings.media_max_logo_bytes if ASSET_LIMIT_KIND[normalized_type] == "logo" else self.settings.media_max_image_bytes
        data = await upload.read(limit + 1)
        if not data:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Imagem vazia.")
        if len(data) > limit:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Imagem maior que o limite permitido.")
        media_id = new_id("med")
        try:
            with Image.open(BytesIO(data)) as source:
                source.load()
                image_format = str(source.format or "").upper()
                if image_format not in ALLOWED_IMAGE_FORMATS:
                    raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Formato de imagem não permitido.")
                content_type, extension = ALLOWED_IMAGE_FORMATS[image_format]
                width, height = source.size
                cleaned = Image.new(source.mode, source.size)
                cleaned.paste(source)
                if image_format == "JPEG" and cleaned.mode not in {"RGB", "L"}:
                    cleaned = cleaned.convert("RGB")
                output = BytesIO()
                save_kwargs: dict[str, Any] = {"format": image_format}
                if image_format == "JPEG":
                    save_kwargs.update({"quality": 88, "optimize": True})
                elif image_format == "PNG":
                    save_kwargs.update({"optimize": True})
                cleaned.save(output, **save_kwargs)
        except HTTPException:
            raise
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Arquivo de imagem inválido ou corrompido.") from exc
        stored_filename = f"{media_id}{extension}"
        final_path = (self.root / stored_filename).resolve()
        if self.root not in final_path.parents:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Caminho de mídia inválido.")
        try:
            final_path.write_bytes(output.getvalue())
        except PermissionError as exc:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "O armazenamento de mídia está sem permissão de escrita. Verifique o volume media_data na VPS.",
            ) from exc
        except OSError as exc:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Não foi possível salvar a imagem no armazenamento de mídia.",
            ) from exc
        base = self.settings.media_public_base_url.rstrip("/") or "/media"
        return StoredMedia(
            id=media_id,
            asset_type=normalized_type,
            original_filename=Path(upload.filename or "").name[:255],
            stored_filename=stored_filename,
            content_type=content_type,
            byte_size=final_path.stat().st_size,
            width=width,
            height=height,
            public_url=f"{base}/{media_id}",
            path=final_path,
        )

    def public_path(self, stored_filename: str) -> Path:
        candidate = (self.root / Path(stored_filename).name).resolve()
        if self.root not in candidate.parents:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Imagem não encontrada.")
        return candidate

    def delete(self, stored_filename: str) -> None:
        path = self.public_path(stored_filename)
        if path.exists():
            path.unlink()
