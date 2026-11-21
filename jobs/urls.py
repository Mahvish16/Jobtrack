from django.urls import path
from rest_framework.routers import DefaultRouter

from .gmail_views import (
    GmailConnectionView,
    GmailConnectView,
    GmailDismissView,
    GmailMessageDetailView,
    GmailMessagesView,
    gmail_callback,
)
from .views import (
    AnalyticsView,
    ChangePasswordView,
    InterviewViewSet,
    JobViewSet,
    MeView,
    RegisterView,
)

# The router generates the list/detail URLs for each ViewSet:
#   /api/jobs/  /api/jobs/<id>/  /api/interviews/  /api/interviews/<id>/
router = DefaultRouter()
router.register("jobs", JobViewSet, basename="job")
router.register("interviews", InterviewViewSet, basename="interview")

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("me/", MeView.as_view(), name="me"),
    path("me/password/", ChangePasswordView.as_view(), name="me-password"),
    path("analytics/", AnalyticsView.as_view(), name="analytics"),

    # Gmail
    path("gmail/connect/", GmailConnectView.as_view(), name="gmail-connect"),
    path("gmail/callback/", gmail_callback, name="gmail-callback"),
    path(
        "gmail/connection/",
        GmailConnectionView.as_view(),
        name="gmail-connection"
    ),
    path("gmail/messages/", GmailMessagesView.as_view(), name="gmail-messages"),
    path(
        "gmail/messages/<str:message_id>/",
        GmailMessageDetailView.as_view(),
        name="gmail-message"
    ),
    path(
        "gmail/messages/<str:message_id>/dismiss/",
        GmailDismissView.as_view(),
        name="gmail-dismiss"
    ),
] + router.urls
