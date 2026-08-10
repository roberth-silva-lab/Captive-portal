from app.core.config import get_settings
from app.integrations.email.service import EmailDeliveryError, send_email


class FakeSMTP:
    calls: list[str] = []

    def __init__(self, host: str, port: int, timeout: float):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.calls.append(f"connect:{host}:{port}")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.calls.append("close")

    def ehlo(self):
        self.calls.append("ehlo")

    def starttls(self):
        self.calls.append("starttls")

    def login(self, user: str, password: str):
        self.calls.append(f"login:{user}:{password}")

    def send_message(self, msg):
        self.calls.append(f"send:{msg['To']}")


def test_send_email_uses_ssl_for_port_465(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "smtp_port", 465)
    monkeypatch.setattr(settings, "smtp_user", "user")
    monkeypatch.setattr(settings, "smtp_password", "pass")
    FakeSMTP.calls = []
    monkeypatch.setattr("app.integrations.email.service.smtplib.SMTP_SSL", FakeSMTP)

    send_email("visitor@example.com", "Assunto", "Mensagem")

    assert FakeSMTP.calls == [
        "connect:smtp.example.test:465",
        "login:user:pass",
        "send:visitor@example.com",
        "close",
    ]


def test_send_email_rejects_incomplete_credentials(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_user", "user")
    monkeypatch.setattr(settings, "smtp_password", "")
    FakeSMTP.calls = []
    monkeypatch.setattr("app.integrations.email.service.smtplib.SMTP", FakeSMTP)

    try:
        send_email("visitor@example.com", "Assunto", "Mensagem")
    except EmailDeliveryError as exc:
        assert exc.reason == "smtp_credentials_incomplete"
    else:
        raise AssertionError("expected EmailDeliveryError")
