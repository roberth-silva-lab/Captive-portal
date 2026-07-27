import smtplib
from email.message import EmailMessage

from app.core.config import get_settings


class EmailDeliveryError(Exception):
    pass


def send_email(to_email: str, subject: str, text: str) -> None:
    settings = get_settings()
    if not settings.smtp_host:
        raise EmailDeliveryError("SMTP_HOST is not configured.")
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg.set_content(text, charset="utf-8")
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds) as smtp:
            smtp.starttls()
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    except Exception as exc:  # noqa: BLE001
        raise EmailDeliveryError("Could not deliver email.") from exc
