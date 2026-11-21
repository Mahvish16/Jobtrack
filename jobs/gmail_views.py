import logging
import os
from datetime import datetime, timezone as dt_timezone

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.cache import cache
from django.http import HttpResponseRedirect
from django.utils import timezone
from django.views.decorators.http import require_GET
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .gmail_parsing import (
    analyse_email,
    clean_snippet,
    extract_body,
    extract_details_from_body,
    find_matching_job,
    is_application_email,
    suggest_status_update,
)
from .models import GmailConnection, Job, TrackedEmail

logger = logging.getLogger(__name__)

User = get_user_model()

# Google normally refuses OAuth over plain http. Allow it only on a
# developer machine, never in production.
if settings.DEBUG:
    os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")

# Read-only access: JobTrack can never send, change or delete email.
GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly"
]

TOKEN_URI = "https://oauth2.googleapis.com/token"
REVOKE_URI = "https://oauth2.googleapis.com/revoke"

STATE_SALT = "jobtrack.gmail.oauth"
STATE_MAX_AGE = 600  # seconds

# Only job-related mail from the last 90 days is ever requested. The braces
# mean OR in Gmail search syntax.
GMAIL_QUERY = (
    'newer_than:90d -category:promotions -category:social '
    '{subject:application subject:applied subject:applying '
    'subject:interview "thank you for applying" "your application"}'
)

RECONNECT_MESSAGE = (
    "Your Gmail connection has expired. Please connect Gmail again."
)


def frontend_redirect(result):
    return HttpResponseRedirect(
        f"{settings.FRONTEND_URL}/emails?gmail={result}"
    )


# ---------------- GMAIL OAUTH ----------------

def get_google_flow(state=None):
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI")

    client_config = {
        "web": {
            "client_id": os.getenv("GOOGLE_CLIENT_ID"),
            "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": TOKEN_URI,
            "redirect_uris": [redirect_uri],
        }
    }

    return Flow.from_client_config(
        client_config,
        scopes=GMAIL_SCOPES,
        state=state,
        redirect_uri=redirect_uri,
    )


class GmailConnectView(APIView):
    """Step 1: give the frontend the Google consent screen URL."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        # The state travels to Google and back. It is signed with
        # SECRET_KEY, so the callback can trust which user started the flow
        # and nobody can forge a callback for a different account (CSRF).
        state = signing.dumps({"user_id": request.user.id}, salt=STATE_SALT)

        flow = get_google_flow(state=state)

        authorization_url, _ = flow.authorization_url(
            access_type="offline",
            prompt="consent",
        )

        # Temporarily store the PKCE code verifier
        cache.set(
            f"gmail_oauth_{state}",
            flow.code_verifier,
            timeout=STATE_MAX_AGE,
        )

        return Response({"authorization_url": authorization_url})


@require_GET
def gmail_callback(request):
    """Step 2: Google sends the browser here with a one-time code, which is
    exchanged for tokens. The browser is then sent back to the React app."""
    state = request.GET.get("state", "")

    # The user pressed "Cancel" on Google's consent screen.
    if request.GET.get("error"):
        return frontend_redirect("denied")

    try:
        data = signing.loads(state, salt=STATE_SALT, max_age=STATE_MAX_AGE)
        user = User.objects.get(id=data["user_id"])
    except Exception:
        return frontend_redirect("error")

    cache_key = f"gmail_oauth_{state}"
    code_verifier = cache.get(cache_key)

    if not code_verifier:
        return frontend_redirect("error")

    # One-time use: the same callback URL cannot be replayed.
    cache.delete(cache_key)

    try:
        flow = get_google_flow(state=state)
        flow.code_verifier = code_verifier
        flow.fetch_token(authorization_response=request.build_absolute_uri())

        credentials = flow.credentials

        GmailConnection.objects.update_or_create(
            user=user,
            defaults={
                "token": credentials.token,
                "refresh_token": credentials.refresh_token or "",
                "token_uri": credentials.token_uri,
                "scopes": list(credentials.scopes or GMAIL_SCOPES),
                "expiry": _aware(credentials.expiry),
            }
        )

        return frontend_redirect("connected")

    except Exception:
        logger.exception("Gmail OAuth callback failed")

        return frontend_redirect("error")


# ---------------- GMAIL CONNECTION ----------------

class GmailConnectionView(APIView):
    """GET: is Gmail connected?   DELETE: disconnect and revoke access."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        connection = GmailConnection.objects.filter(user=request.user).first()

        return Response({
            "connected": connection is not None,
            "connected_at": connection.connected_at if connection else None,
        })

    def delete(self, request):
        connection = GmailConnection.objects.filter(user=request.user).first()

        if connection:
            revoke_google_token(
                connection.refresh_token or connection.token
            )
            connection.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)


def revoke_google_token(token):
    """Asks Google to invalidate the token. Best effort: the local
    connection is deleted even if Google cannot be reached."""
    if not token:
        return

    try:
        requests.post(REVOKE_URI, params={"token": token}, timeout=5)
    except requests.RequestException:
        logger.warning("Could not revoke Google token", exc_info=True)


# ---------------- GMAIL MESSAGES ----------------

def _aware(value):
    """google-auth returns naive UTC datetimes; Django stores aware ones."""
    if value and timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)

    return value


def build_gmail_service(connection):
    """Returns a Gmail API client, refreshing the access token if needed.

    Access tokens last about an hour. The refresh token is exchanged for a
    new one without involving the user. Raises RefreshError when Google has
    revoked or expired the refresh token.
    """
    if not connection.token and not connection.refresh_token:
        raise RefreshError("Stored tokens could not be read.")

    expiry = connection.expiry

    credentials = Credentials(
        token=connection.token,
        refresh_token=connection.refresh_token or None,
        token_uri=connection.token_uri or TOKEN_URI,
        client_id=os.getenv("GOOGLE_CLIENT_ID"),
        client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
        scopes=connection.scopes,
        # google-auth compares against a naive UTC "now".
        expiry=expiry.astimezone(dt_timezone.utc).replace(tzinfo=None)
        if expiry else None,
    )

    if not credentials.valid:
        if not credentials.refresh_token:
            raise RefreshError("Access token expired and no refresh token.")

        credentials.refresh(Request())

        connection.token = credentials.token
        connection.expiry = _aware(credentials.expiry)
        connection.save(update_fields=["token", "expiry"])

    return build("gmail", "v1", credentials=credentials, cache_discovery=False)


def fetch_message_summaries(service, page_token=None, max_results=40):
    """Runs the job-mail search and returns (messages, raw list response).
    Only metadata is requested: subject, sender, date and Gmail's short
    preview. A full message is downloaded only when the user tracks it
    (see fetch_message_body)."""
    list_params = {"userId": "me", "q": GMAIL_QUERY, "maxResults": max_results}

    if page_token:
        list_params["pageToken"] = page_token

    results = service.users().messages().list(**list_params).execute()

    summaries = []

    for message in results.get("messages", []):
        data = service.users().messages().get(
            userId="me",
            id=message["id"],
            format="metadata",
            metadataHeaders=["Subject", "From", "Date"],
        ).execute()

        headers = {
            header["name"]: header["value"]
            for header in data.get("payload", {}).get("headers", [])
        }

        received_at = None

        if data.get("internalDate"):
            received_at = datetime.fromtimestamp(
                int(data["internalDate"]) / 1000, tz=dt_timezone.utc
            )

        summaries.append({
            "id": message["id"],
            "subject": headers.get("Subject", ""),
            "sender": headers.get("From", ""),
            "date": headers.get("Date", ""),
            "received_at": received_at,
            "snippet": clean_snippet(data.get("snippet", "")),
        })

    return summaries, results


class GmailMessagesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        connection = GmailConnection.objects.filter(user=request.user).first()

        if connection is None:
            return Response(
                {
                    "error": "Please connect your Gmail account first.",
                    "code": "gmail_not_connected",
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            service = build_gmail_service(connection)
            summaries, results = fetch_message_summaries(
                service,
                page_token=request.query_params.get("pageToken"),
            )

        except RefreshError:
            # Google no longer accepts the stored tokens (revoked, or the
            # 7-day limit of an OAuth app in "Testing" mode). Forget the
            # connection so the UI offers "Connect Gmail" again.
            connection.delete()

            return Response(
                {"error": RECONNECT_MESSAGE, "code": "gmail_reconnect"},
                status=status.HTTP_400_BAD_REQUEST
            )

        except Exception:
            logger.exception("Gmail fetch failed")

            return Response(
                {"error": "Unable to fetch Gmail messages. Please try again."},
                status=status.HTTP_502_BAD_GATEWAY
            )

        # Duplicate prevention: skip every message already handled.
        handled_ids = set(
            TrackedEmail.objects.filter(
                user=request.user,
                gmail_message_id__in=[item["id"] for item in summaries],
            ).values_list("gmail_message_id", flat=True)
        )

        jobs = list(Job.objects.filter(user=request.user))
        emails = []

        skipped = 0

        for item in summaries:
            if item["id"] in handled_ids:
                continue

            # Leave out adverts, job alerts, newsletters and anything else
            # that is not a reply to the user's own application.
            if not is_application_email(
                item["subject"], item["sender"], item["snippet"]
            ):
                skipped += 1
                continue

            analysis = analyse_email(
                item["subject"], item["sender"], item["snippet"]
            )
            match = find_matching_job(analysis["suggested_company"], jobs)

            emails.append({
                **item,
                **analysis,
                # An application for this company already exists: offer a
                # status update instead of a second application.
                "matching_job": {
                    "id": match.id,
                    "company_name": match.company_name,
                    "job_role": match.job_role,
                    "status": match.status,
                } if match else None,
                "suggested_update": suggest_status_update(
                    match.status, analysis["category"]
                ) if match else None,
            })

        return Response({
            "total_estimated": results.get("resultSizeEstimate", 0),
            "fetched_count": len(summaries),
            "hidden_count": len(summaries) - len(emails),
            # How many were left out because they are not applications.
            "skipped_count": skipped,
            "emails": emails,
            "next_page_token": results.get("nextPageToken"),
            "has_more": bool(results.get("nextPageToken")),
        })


def fetch_message_body(service, message_id):
    """Downloads ONE message in full and returns its subject, sender and
    readable text. Only called for an email the user chose to track."""
    data = service.users().messages().get(
        userId="me", id=message_id, format="full"
    ).execute()

    payload = data.get("payload", {})
    headers = {
        header["name"]: header["value"]
        for header in payload.get("headers", [])
    }

    body = extract_body(payload) or clean_snippet(data.get("snippet", ""))
    details = extract_details_from_body(body)

    return {
        "id": message_id,
        "subject": headers.get("Subject", ""),
        "sender": headers.get("From", ""),
        "body": body,
        # Found only in the full text (the list preview is too short).
        "suggested_role": details["role"],
        "suggested_location": details["location"],
        "suggested_job_url": details["job_url"],
    }


class GmailMessageDetailView(APIView):
    """The full text of one email, so a tracked application keeps the whole
    message instead of Gmail's short preview that ends in "..."."""

    permission_classes = [IsAuthenticated]

    def get(self, request, message_id):
        connection = GmailConnection.objects.filter(user=request.user).first()

        if connection is None:
            return Response(
                {
                    "error": "Please connect your Gmail account first.",
                    "code": "gmail_not_connected",
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            service = build_gmail_service(connection)

            return Response(fetch_message_body(service, message_id))

        except RefreshError:
            connection.delete()

            return Response(
                {"error": RECONNECT_MESSAGE, "code": "gmail_reconnect"},
                status=status.HTTP_400_BAD_REQUEST
            )

        except Exception:
            logger.exception("Gmail message fetch failed")

            return Response(
                {"error": "Unable to load this email. Please try again."},
                status=status.HTTP_502_BAD_GATEWAY
            )


class GmailDismissView(APIView):
    """Hide a Gmail message that is not a job application."""

    permission_classes = [IsAuthenticated]

    def post(self, request, message_id):
        TrackedEmail.objects.get_or_create(
            user=request.user,
            gmail_message_id=message_id[:100],
            defaults={"action": "dismissed"},
        )

        return Response(status=status.HTTP_204_NO_CONTENT)
