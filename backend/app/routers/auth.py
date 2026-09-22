"""
Authentication endpoints: OTP-based email verification.

    POST /api/auth/request-otp   email          -> code emailed
    POST /api/auth/verify-otp    email + code   -> session token
    GET  /api/auth/me            bearer token   -> current user
    POST /api/auth/logout        bearer token   -> revoke every session

The two-step split is what makes this verifiable: nothing is issued until a
code that only reached the registered inbox comes back.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import User
from ..services import auth_service
from ..services.auth_service import AuthError

router = APIRouter(prefix="/auth", tags=["auth"])

# auto_error=False so we can raise our own 401 shape rather than FastAPI's.
_bearer = HTTPBearer(auto_error=False)


# --------------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------------
class RequestOtpIn(BaseModel):
    email: str = Field(..., max_length=255, examples=["you@example.com"])


class RequestOtpOut(BaseModel):
    sent: bool
    email: str = Field(description="Masked, so the UI can confirm the destination.")
    delivery: str = Field(description="'email' when sent, 'console' when SMTP is unset.")
    expires_at: datetime
    expires_in_seconds: int
    code_length: int
    resend_after_seconds: int
    message: str
    debug_code: str | None = Field(
        default=None,
        description="Development only, and only when SMTP is not configured.",
    )


class VerifyOtpIn(BaseModel):
    email: str = Field(..., max_length=255)
    code: str = Field(..., max_length=16)


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    last_login_at: datetime | None = None


class SessionOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserOut


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        last_login_at=user.last_login_at,
    )


def _fail(error: AuthError) -> HTTPException:
    headers = {"Retry-After": str(error.retry_after)} if error.retry_after else None
    return HTTPException(status_code=error.status_code, detail=error.message, headers=headers)


# --------------------------------------------------------------------------
# Dependency: the current signed-in user
# --------------------------------------------------------------------------
def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=401,
            detail="Sign in to continue.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return auth_service.user_from_token(db, credentials.credentials)
    except AuthError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail=error.message,
            headers={"WWW-Authenticate": "Bearer"},
        ) from error


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
@router.post("/request-otp", response_model=RequestOtpOut)
def request_otp(
    payload: RequestOtpIn,
    request: Request,
    db: Session = Depends(get_db),
) -> RequestOtpOut:
    """Generate a one-time code and email it to the address supplied."""
    client_ip = request.client.host if request.client else ""
    try:
        issued = auth_service.issue_otp(db, payload.email, request_ip=client_ip)
    except AuthError as error:
        raise _fail(error) from error

    remaining = int((issued.expires_at - datetime.utcnow()).total_seconds())
    return RequestOtpOut(
        sent=True,
        email=issued.masked_email,
        delivery=issued.delivery,
        expires_at=issued.expires_at,
        expires_in_seconds=max(remaining, 0),
        code_length=settings.otp_length,
        resend_after_seconds=issued.resend_after_seconds,
        message=(
            f"Verification code sent to {issued.masked_email}."
            if issued.delivery == "email"
            else "SMTP is not configured, so the code was written to the server log."
        ),
        debug_code=issued.debug_code,
    )


@router.post("/verify-otp", response_model=SessionOut)
def verify_otp(
    payload: VerifyOtpIn,
    response: Response,
    db: Session = Depends(get_db),
) -> SessionOut:
    """Exchange a valid code for a signed session token."""
    try:
        user = auth_service.verify_otp(db, payload.email, payload.code)
    except AuthError as error:
        raise _fail(error) from error

    token, expires_at = auth_service.issue_token(user)
    response.headers["Cache-Control"] = "no-store"
    return SessionOut(access_token=token, expires_at=expires_at, user=_user_out(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> UserOut:
    """Who the bearer token belongs to. Used by the frontend to restore a session."""
    return _user_out(user)


@router.post("/logout", status_code=204)
def logout(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    """Revoke every token issued to this account, not just the current one."""
    auth_service.revoke_sessions(db, user)
    return Response(status_code=204)
