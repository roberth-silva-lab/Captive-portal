import html
import smtplib
from collections.abc import Callable
from email.message import EmailMessage

from app.core.config import get_settings


class EmailDeliveryError(Exception):
    def __init__(self, message: str, reason: str = "smtp_error"):
        super().__init__(message)
        self.reason = reason


def send_email(to_email: str, subject: str, text: str, html_body: str | None = None) -> None:
    settings = get_settings()
    if not settings.smtp_host:
        raise EmailDeliveryError("SMTP_HOST is not configured.", "smtp_not_configured")
    if not settings.smtp_from:
        raise EmailDeliveryError("SMTP_FROM is not configured.", "smtp_from_not_configured")
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg.set_content(text, charset="utf-8")
    if html_body:
        msg.add_alternative(html_body, subtype="html", charset="utf-8")
    try:
        smtp_factory: Callable[..., smtplib.SMTP] = smtplib.SMTP_SSL if settings.smtp_port == 465 else smtplib.SMTP
        with smtp_factory(settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds) as smtp:
            if settings.smtp_port != 465:
                smtp.ehlo()
                if settings.smtp_port != 25:
                    smtp.starttls()
                    smtp.ehlo()
            if settings.smtp_user or settings.smtp_password:
                if not settings.smtp_user or not settings.smtp_password:
                    raise EmailDeliveryError("SMTP credentials are incomplete.", "smtp_credentials_incomplete")
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    except smtplib.SMTPAuthenticationError as exc:
        raise EmailDeliveryError("Could not authenticate with SMTP server.", "smtp_auth_failed") from exc
    except smtplib.SMTPConnectError as exc:
        raise EmailDeliveryError("Could not connect to SMTP server.", "smtp_connect_failed") from exc
    except (smtplib.SMTPServerDisconnected, smtplib.SMTPHeloError) as exc:
        raise EmailDeliveryError("SMTP server disconnected.", "smtp_disconnected") from exc
    except TimeoutError as exc:
        raise EmailDeliveryError("SMTP request timed out.", "smtp_timeout") from exc
    except smtplib.SMTPException as exc:
        raise EmailDeliveryError("Could not deliver email.", "smtp_delivery_failed") from exc
    except OSError as exc:
        raise EmailDeliveryError("Could not reach SMTP server.", "smtp_network_error") from exc


def wifi_code_email(code: str, ttl_minutes: int) -> tuple[str, str]:
    grouped_code = f"{code[:3]} {code[3:]}" if len(code) == 6 else code
    escaped_code = html.escape(grouped_code)
    text = (
        "Receita Federal - Acesso Wi-Fi Visitantes\n\n"
        "Seu código de confirmação\n\n"
        f"{grouped_code}\n\n"
        f"Este código é válido por {ttl_minutes} minutos.\n"
        "Você recebeu esta mensagem porque foi solicitado acesso à rede Wi-Fi Visitantes.\n"
        "Se você não solicitou este acesso, ignore esta mensagem."
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
                <h1 style="font-size:20px;margin:0 0 12px;">Seu código de confirmação</h1>
                <div style="font-size:38px;letter-spacing:.14em;font-weight:800;color:#123f52;background:#eef6f4;border:1px solid #d8e7e1;border-radius:8px;padding:18px;text-align:center;">{escaped_code}</div>
                <p style="font-size:15px;line-height:1.55;margin:18px 0 0;">Este código é válido por <strong>{ttl_minutes} minutos</strong>.</p>
                <p style="font-size:14px;line-height:1.55;color:#5f706a;margin:12px 0 0;">Você recebeu esta mensagem porque foi solicitado acesso à rede Wi-Fi Visitantes.</p>
                <p style="font-size:14px;line-height:1.55;color:#5f706a;margin:8px 0 0;">Se você não solicitou este acesso, ignore esta mensagem.</p>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body>
    </html>
    """
    return text, html_body

def voucher_email(
    code: str,
    *,
    site: str,
    duration_label: str,
    max_devices: int,
    expires_label: str,
    description: str = "",
) -> tuple[str, str]:
    safe_code = html.escape(code)
    safe_site = html.escape(site)
    safe_duration = html.escape(duration_label)
    safe_expires = html.escape(expires_label)
    safe_description = html.escape(description.strip()) if description.strip() else ""
    description_text = f"Finalidade: {description.strip()}\n" if description.strip() else ""
    description_html = f'<p style="font-size:14px;line-height:1.55;color:#5f706a;"><strong>Finalidade:</strong> {safe_description}</p>' if safe_description else ""
    text = (
        "Receita Federal - Voucher de acesso Wi-Fi\n\n"
        f"Seu voucher: {code}\n\n"
        f"Unidade: {site}\n"
        f"Duração do acesso: {duration_label}\n"
        f"Dispositivos permitidos: {max_devices}\n"
        f"Validade do voucher: {expires_label}\n"
        f"{description_text}\n"
        "Conecte-se à rede de visitantes e informe este código no portal de acesso.\n"
        "Não compartilhe o voucher com outras pessoas se ele for destinado a uso individual."
    )
    html_body = f"""
    <!doctype html>
    <html lang="pt-BR">
      <body style="margin:0;background:#f3f6f5;font-family:Arial,Helvetica,sans-serif;color:#1f2d33;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f5;padding:24px 12px;">
          <tr><td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background:#ffffff;border:1px solid #dce7e3;border-radius:10px;overflow:hidden;">
              <tr><td style="background:#125f78;color:#ffffff;padding:22px 24px;">
                <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.82;">Receita Federal</div>
                <div style="font-size:22px;font-weight:700;margin-top:4px;">Voucher de acesso Wi-Fi</div>
              </td></tr>
              <tr><td style="padding:26px 24px;">
                <p style="font-size:15px;line-height:1.55;margin:0 0 14px;">Use o código abaixo no portal da rede de visitantes.</p>
                <div style="font-size:30px;letter-spacing:.08em;font-weight:800;color:#123f52;background:#eef6f4;border:1px solid #d8e7e1;border-radius:8px;padding:18px;text-align:center;">{safe_code}</div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px;font-size:14px;line-height:1.55;">
                  <tr><td style="padding:6px 0;color:#5f706a;">Unidade</td><td style="padding:6px 0;text-align:right;font-weight:700;">{safe_site}</td></tr>
                  <tr><td style="padding:6px 0;color:#5f706a;">Duração</td><td style="padding:6px 0;text-align:right;font-weight:700;">{safe_duration}</td></tr>
                  <tr><td style="padding:6px 0;color:#5f706a;">Dispositivos</td><td style="padding:6px 0;text-align:right;font-weight:700;">{max_devices}</td></tr>
                  <tr><td style="padding:6px 0;color:#5f706a;">Validade do voucher</td><td style="padding:6px 0;text-align:right;font-weight:700;">{safe_expires}</td></tr>
                </table>
                {description_html}
                <p style="font-size:14px;line-height:1.55;color:#5f706a;margin:18px 0 0;">Conecte-se à rede de visitantes e informe o voucher no portal. Se o código for individual, não o compartilhe.</p>
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

def admin_login_code_email(code: str, ttl_minutes: int) -> tuple[str, str]:
    grouped_code = f"{code[:3]} {code[3:]}" if len(code) == 6 else code
    escaped_code = html.escape(grouped_code)
    text = (
        "Portal Wi-Fi - Código de acesso administrativo\n\n"
        "Seu código de verificação\n\n"
        f"{grouped_code}\n\n"
        f"Este código é válido por {ttl_minutes} minutos.\n"
        "Se você não tentou acessar o painel, ignore esta mensagem."
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
                <div style="font-size:22px;font-weight:700;margin-top:4px;">Verificação administrativa</div>
              </td></tr>
              <tr><td style="padding:26px 24px;">
                <h1 style="font-size:20px;margin:0 0 12px;">Seu código de verificação</h1>
                <div style="font-size:38px;letter-spacing:.14em;font-weight:800;color:#123f52;background:#eef6f4;border:1px solid #d8e7e1;border-radius:8px;padding:18px;text-align:center;">{escaped_code}</div>
                <p style="font-size:15px;line-height:1.55;margin:18px 0 0;">Este código é válido por <strong>{ttl_minutes} minutos</strong>.</p>
                <p style="font-size:14px;line-height:1.55;color:#5f706a;margin:12px 0 0;">Se você não tentou acessar o painel, ignore esta mensagem.</p>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body>
    </html>
    """
    return text, html_body


def admin_password_reset_code_email(code: str, ttl_minutes: int) -> tuple[str, str]:
    grouped_code = f"{code[:3]} {code[3:]}" if len(code) == 6 else code
    escaped_code = html.escape(grouped_code)
    text = (
        "Portal Wi-Fi - Recuperação de senha\n\n"
        "Use o código abaixo para redefinir sua senha administrativa:\n\n"
        f"{grouped_code}\n\n"
        f"Este código é válido por {ttl_minutes} minutos.\n"
        "Se você não solicitou a recuperação, ignore esta mensagem."
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
                <div style="font-size:22px;font-weight:700;margin-top:4px;">Recuperação de senha</div>
              </td></tr>
              <tr><td style="padding:26px 24px;">
                <h1 style="font-size:20px;margin:0 0 12px;">Código para redefinir senha</h1>
                <div style="font-size:38px;letter-spacing:.14em;font-weight:800;color:#123f52;background:#eef6f4;border:1px solid #d8e7e1;border-radius:8px;padding:18px;text-align:center;">{escaped_code}</div>
                <p style="font-size:15px;line-height:1.55;margin:18px 0 0;">Este código é válido por <strong>{ttl_minutes} minutos</strong>.</p>
                <p style="font-size:14px;line-height:1.55;color:#5f706a;margin:12px 0 0;">Se você não solicitou a recuperação, ignore esta mensagem.</p>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body>
    </html>
    """
    return text, html_body
