from django.contrib.auth import get_user_model
from django.middleware.csrf import get_token
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .authentication import (
    REFRESH_COOKIE,
    clear_auth_cookies,
    set_auth_cookies,
)

User = get_user_model()


class LoginView(APIView):
    """POST /api/token/  {username, password, remember}

    Checks the password and puts the tokens in HttpOnly cookies. The
    response body deliberately contains no token.
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    # Rate limited, to slow down password guessing.
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request):
        # simplejwt's serializer checks the username and password.
        serializer = TokenObtainPairSerializer(data=request.data)

        try:
            serializer.is_valid(raise_exception=True)
        except AuthenticationFailed as error:
            # 401 = "who are you?" (wrong username or password).
            return Response(
                {"detail": str(error.detail)},
                status=status.HTTP_401_UNAUTHORIZED
            )

        user = serializer.user
        remember = bool(request.data.get("remember", True))

        refresh = RefreshToken.for_user(user)
        # Remembered inside the token, so a later refresh keeps the choice.
        refresh["remember"] = remember

        response = Response({
            "username": user.username,
            "first_name": user.first_name,
        })
        set_auth_cookies(response, refresh, remember)

        # Also sends the CSRF cookie the frontend needs from now on.
        get_token(request)

        return response


class RefreshView(APIView):
    """POST /api/token/refresh/

    The access token lasts 30 minutes. When it runs out, the frontend calls
    this; the longer-lived refresh cookie is exchanged for a new access
    cookie without asking for the password again.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        raw_token = request.COOKIES.get(REFRESH_COOKIE)

        try:
            if not raw_token:
                raise TokenError("No refresh token.")

            # Checks the signature and the expiry date.
            refresh = RefreshToken(raw_token)

            # The account may have been deleted or disabled since login.
            if not User.objects.filter(
                pk=refresh["user_id"], is_active=True
            ).exists():
                raise TokenError("User no longer exists.")

        except (TokenError, KeyError):
            response = Response(
                {"detail": "Session expired. Please log in again."},
                status=status.HTTP_401_UNAUTHORIZED
            )
            clear_auth_cookies(response)

            return response

        response = Response({"detail": "Session refreshed."})
        set_auth_cookies(response, refresh, bool(refresh.get("remember", True)))
        get_token(request)

        return response


class LogoutView(APIView):
    """POST /api/token/logout/  Deletes the login cookies."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_auth_cookies(response)

        return response
