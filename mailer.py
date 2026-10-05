"""Transactional email via Resend (https://resend.com). Stdlib only.

    RESEND_API_KEY   re_...   (unset in dev: emails are printed to the console instead)
    EMAIL_FROM       "GameRecon <noreply@yourdomain.com>"  — must be a domain verified in Resend.
                     Default onboarding@resend.dev only delivers to your own Resend account email.
"""
import html
import json
import os
import threading
import urllib.error
import urllib.request

API_KEY = os.environ.get("RESEND_API_KEY", "")
FROM = os.environ.get("EMAIL_FROM", "GameRecon <onboarding@resend.dev>")


def _send(to, subject, html_body, text_body):
    if not API_KEY:
        print(f"\n[dev email] to={to}\nsubject: {subject}\n{text_body}\n", flush=True)
        return
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps({"from": FROM, "to": [to], "subject": subject, "html": html_body, "text": text_body}).encode(),
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json",
                 "User-Agent": "GameRecon/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            r.read()
    except urllib.error.HTTPError as e:
        print(f"[email] Resend error {e.code}: {e.read()[:300]!r}", flush=True)
    except Exception as e:
        print(f"[email] send failed: {e!r}", flush=True)


def send_async(to, subject, html_body, text_body):
    """Fire and forget, so the HTTP response time never reveals whether an email was sent."""
    threading.Thread(target=_send, args=(to, subject, html_body, text_body), daemon=True).start()


def send_password_reset(to, name, link, minutes):
    hi = f"Hi {name}," if name else "Hi,"
    text = (f"{hi}\n\nSomeone (hopefully you) asked to reset your GameRecon password.\n"
            f"Choose a new one here (link works for {minutes} minutes, one time only):\n\n{link}\n\n"
            "If you didn't ask for this, ignore this email — your password won't change.\n\n— GameRecon")
    safe_link = html.escape(link, quote=True)
    body = f"""<div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#121826">
  <h2 style="margin:0 0 16px">Game<span style="color:#2f6bff">RECON</span></h2>
  <p>{html.escape(hi)}</p>
  <p>Someone (hopefully you) asked to reset your GameRecon password.</p>
  <p style="margin:24px 0"><a href="{safe_link}" style="background:#2f6bff;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Choose a new password</a></p>
  <p style="color:#667085;font-size:13px">This link works for {minutes} minutes and can be used once.
  If you didn't ask for this, ignore this email — your password won't change.</p>
</div>"""
    send_async(to, "Reset your GameRecon password", body, text)
