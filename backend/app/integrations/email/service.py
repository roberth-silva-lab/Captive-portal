import html
import smtplib
from email.message import EmailMessage

from app.core.config import get_settings


class EmailDeliveryError(Exception):
    pass


def send_email(to_email: str, subject: str, text: str, html_body: str | None = None) -> None:
    settings = get_settings()
    if not settings.smtp_host:
        raise EmailDeliveryError("SMTP_HOST is not configured.")
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg.set_content(text, charset="utf-8")
    if html_body:
        msg.add_alternative(html_body, subtype="html", charset="utf-8")
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds) as smtp:
            smtp.starttls()
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    except Exception as exc:  # noqa: BLE001
        raise EmailDeliveryError("Could not deliver email.") from exc


def wifi_code_email(code: str, ttl_minutes: int) -> tuple[str, str]:
    grouped_code = f"{code[:3]} {code[3:]}" if len(code) == 6 else code
    escaped_code = html.escape(grouped_code)
    text = (
        "Receita Federal - Acesso Wi-Fi Visitantes\n\n"
        "Seu codigo de confirmacao\n\n"
        f"{grouped_code}\n\n"
        f"Este codigo e valido por {ttl_minutes} minutos.\n"
        "Voce recebeu esta mensagem porque foi solicitado acesso a rede Wi-Fi Visitantes.\n"
        "Se voce nao solicitou este acesso, ignore esta mensagem."
    )
    html_body = f"""
    <!doctype html>
    <html lang="pt-BR">
      <body style="margin:0;background:#f3f6f5;font-family:Arial,Helvetica,sans-serif;color:#1f2d33;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f5;padding:24px 12px;">
          <tr><td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dce7e3;border-radius:8px;overflow:hidden;">
              <tr><td style="background:#125f78;color:#ffffff;padding:22px 24px;">
                <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.82;">Receita Federal</div>
                <div style="font-size:22px;font-weight:700;margin-top:4px;">Acesso Wi-Fi Visitantes</div>
              </td></tr>
              <tr><td style="padding:26px 24px;">
                <h1 style="font-size:20px;margin:0 0 12px;">Seu codigo de confirmacao</h1>
                <div style="font-size:38px;letter-spacing:.14em;font-weight:800;color:#123f52;background:#eef6f4;border:1px solid #d8e7e1;border-radius:8px;padding:18px;text-align:center;">{escaped_code}</div>
                <p style="font-size:15px;line-height:1.55;margin:18px 0 0;">Este codigo e valido por <strong>{ttl_minutes} minutos</strong>.</p>
                <p style="font-size:14px;line-height:1.55;color:#5f706a;margin:12px 0 0;">Voce recebeu esta mensagem porque foi solicitado acesso a rede Wi-Fi Visitantes.</p>
                <p style="font-size:14px;line-height:1.55;color:#5f706a;margin:8px 0 0;">Se voce nao solicitou este acesso, ignore esta mensagem.</p>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body>
    </html>
    """
    return text, html_body

def admin_invitation_email(name: str, invite_url: str, expires_hours: int) -> tuple[str, str]:
    safe_name = html.escape(name)
    safe_url = html.escape(invite_url)
    text = (
        "Portal Wi-Fi - Convite administrativo\n\n"
        f"Olá, {name}.\n\n"
        "Você foi convidado para administrar o Portal Wi-Fi.\n"
        f"Acesse o link abaixo em até {expires_hours} horas para definir sua senha:\n\n"
        f"{invite_url}\n\n"
        "Se você não esperava este convite, ignore esta mensagem."
    )
    html_body = f"""
    <!doctype html>
    <html lang="pt-BR">
      <body style="margin:0;background:#f3f6f5;font-family:Arial,Helvetica,sans-serif;color:#1f2d33;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f5;padding:24px 12px;">
          <tr><td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dce7e3;border-radius:8px;overflow:hidden;">
              <tr><td style="background:#125f78;color:#ffffff;padding:22px 24px;">
                <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.82;">Portal Wi-Fi</div>
                <div style="font-size:22px;font-weight:700;margin-top:4px;">Convite administrativo</div>
              </td></tr>
              <tr><td style="padding:26px 24px;">
                <h1 style="font-size:20px;margin:0 0 12px;">Olá, {safe_name}</h1>
                <p style="font-size:15px;line-height:1.55;">Você foi convidado para administrar o Portal Wi-Fi.</p>
                <p style="font-size:15px;line-height:1.55;">Este convite expira em <strong>{expires_hours} horas</strong>.</p>
                <p style="margin:24px 0;"><a href="{safe_url}" style="background:#125f78;color:#ffffff;text-decoration:none;padding:13px 18px;border-radius:8px;font-weight:700;display:inline-block;">Definir minha senha</a></p>
                <p style="font-size:13px;line-height:1.55;color:#5f706a;">Se o botão não funcionar, copie e cole este link no navegador:<br>{safe_url}</p>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body>
    </html>
    """
    return text, html_body