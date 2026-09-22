"""
Authentication: OTP issue, OTP verification, and session tokens.

The flow is passwordless. A user proves control of a registered email address
by receiving a short-lived numeric code there and returning it. That is the
only credential in the system, so the code is treated like one:

  * generated with `secrets`, never with `random`
  * stored as sha256(code + per-row salt), never in plaintext
  * single-use, short-lived, and attempt-limited
  * compared in constant time
  * superseded codes are invalidated the moment a new one is issued

Session tokens are HMAC-SHA256 signed (the same construction as a JWT with
alg=HS256, minus the dependency). They carry a `ver` claim that is checked
against the user's `token_version`, so "sign out everywhere" is one increment.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import smtplib
import ssl
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..models import OtpCode, User, utcnow

logger = logging.getLogger("voltaura.auth")

# Falls back to a per-process secret so local development works out of the box.
# Every session dies on restart in that case, which is the safe failure mode.
_EPHEMERAL_SECRET = secrets.token_urlsafe(48)


class AuthError(Exception):
    """Raised for any recoverable authentication failure."""

    def __init__(self, message: str, *, status_code: int = 400, retry_after: int | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.retry_after = retry_after


# --------------------------------------------------------------------------
# Email address handling
# --------------------------------------------------------------------------
def normalise_email(raw: str) -> str:
    """Lowercase and strip so one human maps to exactly one account row."""
    _, addr = parseaddr((raw or "").strip())
    email = (addr or raw or "").strip().lower()
    if not email or "@" not in email or email.startswith("@") or email.endswith("@"):
        raise AuthError("Enter a valid email address.", status_code=422)
    local, _, domain = email.partition("@")
    if not local or "." not in domain or domain.endswith("."):
        raise AuthError("Enter a valid email address.", status_code=422)

    allowed = settings.allowed_email_domain_list
    if allowed and domain not in allowed:
        raise AuthError(
            f"Sign-in is restricted to: {', '.join(allowed)}.",
            status_code=403,
        )
    return email


def mask_email(email: str) -> str:
    """`sameer@example.com` -> `sa****@example.com`, for echoing back safely."""
    local, _, domain = email.partition("@")
    if len(local) <= 2:
        shown = local[:1]
    else:
        shown = local[:2]
    return f"{shown}{'*' * max(2, len(local) - len(shown))}@{domain}"


# --------------------------------------------------------------------------
# OTP
# --------------------------------------------------------------------------
def _hash_code(code: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{code}".encode("utf-8")).hexdigest()


def _generate_code(length: int) -> str:
    """Uniformly distributed numeric code with no modulo bias."""
    upper = 10**length
    return str(secrets.randbelow(upper)).zfill(length)


@dataclass
class OtpIssued:
    email: str
    masked_email: str
    expires_at: datetime
    delivery: str
    resend_after_seconds: int
    # Only ever populated for local development without SMTP configured.
    debug_code: str | None = None


def get_or_create_user(db: Session, email: str) -> User:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        user = User(email=email, name=email.partition("@")[0].replace(".", " ").title())
        db.add(user)
        db.flush()
        logger.info("Registered new user %s", mask_email(email))
    return user


def _throttle(db: Session, user: User) -> None:
    """Reject a resend storm before generating anything."""
    window_start = utcnow() - timedelta(minutes=settings.otp_request_window_minutes)
    recent = db.execute(
        select(OtpCode)
        .where(OtpCode.user_id == user.id, OtpCode.created_at >= window_start)
        .order_by(OtpCode.created_at.desc())
    ).scalars().all()

    if len(recent) >= settings.otp_max_requests_per_window:
        oldest = recent[-1].created_at
        retry_after = int(
            (oldest + timedelta(minutes=settings.otp_request_window_minutes) - utcnow())
            .total_seconds()
        )
        raise AuthError(
            "Too many codes requested. Try again shortly.",
            status_code=429,
            retry_after=max(retry_after, 1),
        )


def issue_otp(db: Session, raw_email: str, *, request_ip: str = "") -> OtpIssued:
    """Create a fresh code, invalidate any earlier ones, and deliver it."""
    email = normalise_email(raw_email)
    user = get_or_create_user(db, email)

    if not user.is_active:
        raise AuthError("This account has been disabled.", status_code=403)

    _throttle(db, user)

    # Any code still outstanding is retired now, so only the newest works.
    db.execute(
        update(OtpCode)
        .where(OtpCode.user_id == user.id, OtpCode.consumed_at.is_(None))
        .values(consumed_at=utcnow())
    )

    code = _generate_code(settings.otp_length)
    salt = secrets.token_hex(16)
    expires_at = utcnow() + timedelta(minutes=settings.otp_ttl_minutes)

    delivered = _send_otp_email(email, code, settings.otp_ttl_minutes)

    db.add(
        OtpCode(
            user_id=user.id,
            code_hash=_hash_code(code, salt),
            salt=salt,
            expires_at=expires_at,
            purpose="login",
            delivery=delivered,
            request_ip=request_ip[:64],
        )
    )
    db.commit()

    # Without SMTP there is no inbox to check, so the code goes to the server
    # log and — in development only — back to the caller, so the flow is still
    # demonstrable. Never in any other environment.
    debug_code = None
    if delivered == "console":
        logger.warning(
            "SMTP is not configured. OTP for %s is %s (valid %d minutes).",
            mask_email(email),
            code,
            settings.otp_ttl_minutes,
        )
        if settings.environment.lower() == "development":
            debug_code = code

    return OtpIssued(
        email=email,
        masked_email=mask_email(email),
        expires_at=expires_at,
        delivery=delivered,
        resend_after_seconds=30,
        debug_code=debug_code,
    )


def verify_otp(db: Session, raw_email: str, code: str) -> User:
    """Consume a code and return the authenticated user, or raise."""
    email = normalise_email(raw_email)
    code = (code or "").strip().replace(" ", "").replace("-", "")

    if not code.isdigit() or len(code) != settings.otp_length:
        raise AuthError(f"Enter the {settings.otp_length}-digit code.", status_code=422)

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None or not user.is_active:
        # Same message as a wrong code: never reveal whether an account exists.
        raise AuthError("That code is not valid. Request a new one.", status_code=401)

    otp = db.execute(
        select(OtpCode)
        .where(OtpCode.user_id == user.id, OtpCode.consumed_at.is_(None))
        .order_by(OtpCode.created_at.desc())
    ).scalars().first()

    if otp is None:
        raise AuthError("That code is not valid. Request a new one.", status_code=401)

    if otp.expires_at <= utcnow():
        otp.consumed_at = utcnow()
        db.commit()
        raise AuthError("That code has expired. Request a new one.", status_code=401)

    if otp.attempts >= settings.otp_max_attempts:
        otp.consumed_at = utcnow()
        db.commit()
        raise AuthError("Too many incorrect attempts. Request a new code.", status_code=429)

    otp.attempts += 1

    if not hmac.compare_digest(otp.code_hash, _hash_code(code, otp.salt)):
        remaining = max(settings.otp_max_attempts - otp.attempts, 0)
        db.commit()
        if remaining == 0:
            raise AuthError("Too many incorrect attempts. Request a new code.", status_code=429)
        raise AuthError(
            f"Incorrect code. {remaining} attempt{'s' if remaining != 1 else ''} left.",
            status_code=401,
        )

    otp.consumed_at = utcnow()
    user.last_login_at = utcnow()
    db.commit()
    logger.info("Login verified for %s", mask_email(email))
    return user


# --------------------------------------------------------------------------
# Session tokens (HMAC-SHA256, JWT-compatible shape)
# --------------------------------------------------------------------------
def _signing_key() -> bytes:
    key = settings.auth_secret_key or _EPHEMERAL_SECRET
    if not settings.auth_secret_key:
        logger.debug("VOLTAURA_AUTH_SECRET_KEY unset; using a per-process secret.")
    return key.encode("utf-8")


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(raw: str) -> bytes:
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def issue_token(user: User) -> tuple[str, datetime]:
    expires_at = utcnow() + timedelta(hours=settings.auth_token_ttl_hours)
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "ver": user.token_version,
        "iat": int(utcnow().timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": secrets.token_urlsafe(12),
    }
    signing_input = ".".join(
        _b64url(json.dumps(part, separators=(",", ":"), sort_keys=True).encode())
        for part in (header, payload)
    )
    signature = hmac.new(_signing_key(), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url(signature)}", expires_at


def decode_token(token: str) -> dict:
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except ValueError:
        raise AuthError("Invalid session token.", status_code=401) from None

    expected = hmac.new(
        _signing_key(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256
    ).digest()
    if not hmac.compare_digest(_b64url(expected), signature_b64):
        raise AuthError("Invalid session token.", status_code=401)

    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except Exception:  # noqa: BLE001
        raise AuthError("Invalid session token.", status_code=401) from None

    if int(payload.get("exp", 0)) <= int(utcnow().timestamp()):
        raise AuthError("Session expired. Sign in again.", status_code=401)

    return payload


def user_from_token(db: Session, token: str) -> User:
    payload = decode_token(token)
    user = db.get(User, int(payload.get("sub", 0) or 0))
    if user is None or not user.is_active:
        raise AuthError("Session is no longer valid.", status_code=401)
    if int(payload.get("ver", 0)) != user.token_version:
        raise AuthError("Session was revoked. Sign in again.", status_code=401)
    return user


def revoke_sessions(db: Session, user: User) -> None:
    """Sign out everywhere by invalidating every token already issued."""
    user.token_version += 1
    db.commit()


# --------------------------------------------------------------------------
# Delivery
# --------------------------------------------------------------------------
_TEXT_TEMPLATE = """\
Your VOLTAURA verification code is {code}

It expires in {minutes} minutes and can be used once.

If you did not try to sign in, you can ignore this email — the code is
useless without access to this inbox.

VOLTAURA — Detect. Understand. Act. Verify.
"""

_HTML_TEMPLATE = """\
<!doctype html>
<html>
  <body style="margin:0;padding:32px;background:#0b0d0e;font-family:-apple-system,
               BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="440" cellpadding="0" cellspacing="0"
               style="background:#121516;border:1px solid rgba(255,255,255,0.08);
                      border-radius:8px;padding:32px;">
          <tr><td style="font:600 11px/1 system-ui;letter-spacing:.14em;
                         text-transform:uppercase;color:#6a7278;">VOLTAURA</td></tr>
          <tr><td style="padding-top:14px;font:600 19px/1.3 system-ui;color:#e9edee;">
            Your verification code
          </td></tr>
          <tr><td style="padding-top:8px;font:400 13px/1.6 system-ui;color:#97a1a5;">
            Enter this code to finish signing in. It expires in {minutes} minutes
            and can only be used once.
          </td></tr>
          <tr><td align="center" style="padding:28px 0 8px;">
            <div style="display:inline-block;font:600 32px/1 ui-monospace,SFMono-Regular,
                        Menlo,monospace;letter-spacing:.34em;color:#2cd48e;
                        padding:16px 8px 16px 22px;border:1px solid rgba(44,212,142,.35);
                        border-radius:6px;background:rgba(44,212,142,.06);">{code}</div>
          </td></tr>
          <tr><td style="padding-top:22px;border-top:1px solid rgba(255,255,255,.07);
                         font:400 11px/1.6 system-ui;color:#6a7278;">
            If you did not try to sign in, ignore this email. The code is useless
            without access to this inbox.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
"""


def _send_otp_email(email: str, code: str, minutes: int) -> str:
    """Return the delivery channel actually used: 'email' or 'console'."""
    if not settings.smtp_configured:
        return "console"

    message = EmailMessage()
    name, addr = parseaddr(settings.smtp_from)
    message["From"] = formataddr((name or "VOLTAURA", addr or settings.smtp_from))
    message["To"] = email
    message["Subject"] = f"{code} is your VOLTAURA verification code"
    message.set_content(_TEXT_TEMPLATE.format(code=code, minutes=minutes))
    message.add_alternative(
        _HTML_TEMPLATE.format(code=code, minutes=minutes), subtype="html"
    )

    try:
        if settings.smtp_port == 465:
            with smtplib.SMTP_SSL(
                settings.smtp_host, settings.smtp_port, timeout=15,
                context=ssl.create_default_context(),
            ) as server:
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.send_message(message)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
                server.ehlo()
                if settings.smtp_starttls:
                    server.starttls(context=ssl.create_default_context())
                    server.ehlo()
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.send_message(message)
    except Exception as exc:  # noqa: BLE001
        # A mail outage must not silently pass as a delivered code.
        logger.error("Could not email the OTP to %s: %s", mask_email(email), exc)
        raise AuthError(
            "Could not send the verification email. Try again in a moment.",
            status_code=502,
        ) from exc

    logger.info("OTP emailed to %s", mask_email(email))
    return "email"
