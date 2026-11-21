"""
Login tokens in HttpOnly cookies.

The browser stores the two JWTs (access and refresh) in cookies marked
HttpOnly, which means JavaScript cannot read them. If a malicious script
ever ran on the page (an XSS attack) it could not steal the tokens, which
it could if they were kept in localStorage.

Cookies are sent by the browser automatically, and that opens a different
attack: another website could make the browser send a request to our API
(CSRF, cross-site request forgery). Two things stop it:
  - SameSite=Lax: the browser does not attach the cookies to cross-site
    POST / PUT / PATCH / DELETE requests;
  - a CSRF token: every request that changes data must also carry a value
    that only our own pages can read (the X-CSRFToken header).
"""

from django.conf import settings
from django.middleware.csrf import CsrfViewMiddleware
from rest_framework import exceptions
from rest_framework_simplejwt.authentication import JWTAuthentication

ACCESS_COOKIE = "jobtrack_access"
REFRESH_COOKIE = "jobtrack_refresh"

# Each cookie is only sent to the URLs that need it.
ACCESS_PATH = "/api/"
REFRESH_PATH = "/api/token/"


class _CSRFCheck(CsrfViewMiddleware):
    def _reject(self, request, reason):
        # Return the reason instead of an HTML error page.
        return reason


def enforce_csrf(request):
    """Runs Django's CSRF check for a request authenticated by cookie."""

    def dummy_get_response(request):
        return None

    check = _CSRFCheck(dummy_get_response)
    check.process_request(request)
    reason = check.process_view(request, None, (), {})

    if reason:
        raise exceptions.PermissionDenied(f"CSRF Failed: {reason}")


class CookieJWTAuthentication(JWTAuthentication):
    """Reads the access token from the cookie instead of a header."""

    def authenticate(self, request):
        raw_token = request.COOKIES.get(ACCESS_COOKIE)

        if not raw_token:
            return None  # not logged in

        # Raises InvalidToken (-> 401) if the token is expired or forged.
        validated_token = self.get_validated_token(raw_token)
        user = self.get_user(validated_token)

        enforce_csrf(request)

        return user, validated_token


def _cookie_options(path, max_age):
    return {
        "path": path,
        # None = a "session cookie": deleted when the browser closes.
        "max_age": max_age,
        "httponly": True,
        "samesite": "Lax",
        # Only over https in production.
        "secure": settings.AUTH_COOKIE_SECURE,
    }


def set_auth_cookies(response, refresh, remember):
    """Stores both tokens on the response. `refresh` is a RefreshToken."""
    lifetime = settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]
    max_age = int(lifetime.total_seconds()) if remember else None

    response.set_cookie(
        ACCESS_COOKIE,
        str(refresh.access_token),
        **_cookie_options(ACCESS_PATH, max_age),
    )
    response.set_cookie(
        REFRESH_COOKIE,
        str(refresh),
        **_cookie_options(REFRESH_PATH, max_age),
    )


def clear_auth_cookies(response):
    response.delete_cookie(ACCESS_COOKIE, path=ACCESS_PATH, samesite="Lax")
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_PATH, samesite="Lax")
