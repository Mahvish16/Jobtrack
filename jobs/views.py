from datetime import date, timedelta

from django.db.models import Count, Min, Q
from django.db.models.functions import TruncMonth
from django.middleware.csrf import get_token
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .authentication import clear_auth_cookies
from .models import GmailConnection, Interview, Job, TrackedEmail
from .serializers import (
    ChangePasswordSerializer,
    InterviewSerializer,
    JobSerializer,
    ProfileSerializer,
    RegisterSerializer,
)


class OptionalPagination(PageNumberPagination):
    """Returns the full list by default; paginates only when the client asks
    with ?page_size=10 (then ?page=2, ...)."""

    page_size = None
    page_size_query_param = 'page_size'
    max_page_size = 100


# ---------------- JOB APIs ----------------

class JobViewSet(viewsets.ModelViewSet):
    """CRUD for the logged-in user's applications.

    GET    /api/jobs/        list   (?search=  ?status=  ?ordering=)
    POST   /api/jobs/        create
    GET    /api/jobs/<id>/   retrieve
    PUT    /api/jobs/<id>/   update   (PATCH for partial update)
    DELETE /api/jobs/<id>/   delete
    """

    serializer_class = JobSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = OptionalPagination
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ['company_name', 'job_role', 'location']
    ordering_fields = ['applied_date', 'company_name', 'salary', 'created_at']

    def get_queryset(self):
        # User data isolation: every query starts from the current user's
        # rows, so another user's job ID simply returns 404.
        queryset = Job.objects.filter(user=self.request.user)

        status_filter = self.request.query_params.get('status')

        if status_filter:
            queryset = queryset.filter(status=status_filter)

        return queryset

    def _record_email(self, job, message_id, action):
        if message_id:
            TrackedEmail.objects.update_or_create(
                user=self.request.user,
                gmail_message_id=message_id,
                defaults={'job': job, 'action': action},
            )

    def perform_create(self, serializer):
        message_id = serializer.validated_data.pop('gmail_message_id', '')
        job = serializer.save(user=self.request.user)

        self._record_email(job, message_id, 'tracked')

    def perform_update(self, serializer):
        message_id = serializer.validated_data.pop('gmail_message_id', '')
        job = serializer.save()

        self._record_email(job, message_id, 'status_update')


# ---------------- INTERVIEW APIs ----------------

class InterviewViewSet(viewsets.ModelViewSet):
    """CRUD for interviews. Ownership is checked through the parent job."""

    serializer_class = InterviewSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # select_related does a SQL JOIN so reading job.company_name for
        # every interview does not trigger one extra query per row.
        queryset = Interview.objects.select_related('job').filter(
            job__user=self.request.user
        )

        job_id = self.request.query_params.get('job')

        if job_id and job_id.isdigit():
            queryset = queryset.filter(job_id=job_id)

        return queryset


# ---------------- ACCOUNT APIs ----------------

class RegisterView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'register'

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)

        if serializer.is_valid():
            serializer.save()

            return Response(
                {
                    "message": "User registered successfully",
                    "user": serializer.data
                },
                status=status.HTTP_201_CREATED
            )

        return Response(
            serializer.errors,
            status=status.HTTP_400_BAD_REQUEST
        )


class MeView(APIView):
    """The logged-in user's own account.

    GET    /api/me/   who am I (name, email, Gmail status)
    PATCH  /api/me/   edit name and email
    DELETE /api/me/   delete the account (password required)
    """

    permission_classes = [IsAuthenticated]

    def _payload(self, user):
        data = ProfileSerializer(user).data
        data["gmail_connected"] = GmailConnection.objects.filter(
            user=user
        ).exists()
        data["date_joined"] = user.date_joined

        return data

    def get(self, request):
        # Makes sure the browser has the CSRF cookie it must send back with
        # every request that changes data.
        get_token(request)

        return Response(self._payload(request.user))

    def patch(self, request):
        serializer = ProfileSerializer(
            request.user, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(self._payload(request.user))

    def delete(self, request):
        # Deleting is permanent, so a stolen login token alone must not be
        # enough: the password is asked for again.
        if not request.user.check_password(request.data.get("password", "")):
            return Response(
                {"password": ["Password is incorrect."]},
                status=status.HTTP_400_BAD_REQUEST
            )

        connection = GmailConnection.objects.filter(user=request.user).first()

        if connection:
            # Imported here to avoid a circular import with gmail_views.
            from .gmail_views import revoke_google_token

            revoke_google_token(connection.refresh_token or connection.token)

        # ON DELETE CASCADE removes the user's applications, interviews,
        # Gmail connection and tracked emails with the account.
        request.user.delete()

        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_auth_cookies(response)

        return response


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)

        # set_password stores a new salted hash.
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])

        return Response({"message": "Password changed."})


# ---------------- ANALYTICS API ----------------

def _percentage(part, whole):
    return round(part * 100 / whole, 1) if whole else 0.0


def _last_months(count):
    """First day of each of the last `count` months, oldest first."""
    today = timezone.localdate()
    year, month = today.year, today.month
    months = []

    for _ in range(count):
        months.append(date(year, month, 1))
        month -= 1

        if month == 0:
            month, year = 12, year - 1

    return list(reversed(months))


RANGE_DAYS = {"30": 30, "90": 90, "365": 365}


class AnalyticsView(APIView):
    """Job search statistics, calculated by the database.

    GET /api/analytics/            everything
    GET /api/analytics/?range=90   only applications from the last 90 days
                                   (30, 90 or 365)

    Each block is one GROUP BY query (values() + annotate(Count)) instead of
    loading every row into Python and counting there.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = timezone.localdate()
        all_jobs = Job.objects.filter(user=request.user)

        # The chosen period applies to the totals, rates and "top" lists.
        # The two time charts always show their own fixed window.
        range_key = request.query_params.get("range", "all")
        days = RANGE_DAYS.get(range_key)
        jobs = all_jobs

        if days:
            jobs = jobs.filter(applied_date__gte=today - timedelta(days=days - 1))
        else:
            range_key = "all"

        interviews = Interview.objects.filter(job__in=jobs)

        total = jobs.count()

        # SELECT status, COUNT(*) ... GROUP BY status
        status_counts = dict(
            jobs.order_by().values_list('status').annotate(count=Count('id'))
        )
        by_status = [
            {"status": value, "count": status_counts.get(value, 0)}
            for value, _label in Job.STATUS_CHOICES
        ]

        # Applications per month for the last 12 months.
        months = _last_months(12)
        month_counts = dict(
            all_jobs.filter(applied_date__gte=months[0])
            .order_by()
            .annotate(month=TruncMonth('applied_date'))
            .values_list('month')
            .annotate(count=Count('id'))
        )
        monthly = [
            {
                "month": month.strftime('%Y-%m'),
                "label": month.strftime('%b %Y'),
                "count": month_counts.get(month, 0),
            }
            for month in months
        ]

        # Applications per day for the last 12 weeks (the activity grid).
        # It starts on a Monday so every column is one whole week.
        this_monday = today - timedelta(days=today.weekday())
        grid_start = this_monday - timedelta(weeks=11)
        day_counts = dict(
            all_jobs.filter(applied_date__gte=grid_start, applied_date__lte=today)
            .order_by()
            .values_list('applied_date')
            .annotate(count=Count('id'))
        )
        daily = [
            {
                "date": (grid_start + timedelta(days=offset)).isoformat(),
                "count": day_counts.get(grid_start + timedelta(days=offset), 0),
            }
            for offset in range((today - grid_start).days + 1)
        ]

        # This month compared with the one before.
        this_month = months[-1]
        last_month = months[-2]

        def top(field):
            return list(
                jobs.exclude(**{field: ''})
                .order_by()
                .values(field)
                .annotate(count=Count('id'))
                .order_by('-count', field)[:5]
            )

        # "Interested" means not applied yet, so it is left out of the rates.
        submitted = total - status_counts.get('Interested', 0)
        selected = status_counts.get('Selected', 0)
        rejected = status_counts.get('Rejected', 0)

        # Reached the interview stage: status says so, or at least one
        # interview was recorded (covers "rejected after interviewing").
        reached_interview = (
            jobs.exclude(status='Interested')
            .filter(
                Q(status__in=['Interview', 'Selected'])
                | Q(interviews__isnull=False)
            )
            .distinct()
            .count()
        )

        # Heard back at all: anything except still waiting on "Applied".
        responded = (
            jobs.filter(
                Q(status__in=['Interview', 'Selected', 'Rejected'])
                | Q(interviews__isnull=False)
            )
            .exclude(status='Interested')
            .distinct()
            .count()
        )

        # Days from applying to the first interview, averaged.
        # MIN(scheduled_at) per job is one grouped query.
        first_interviews = (
            jobs.filter(interviews__isnull=False)
            .order_by()
            .annotate(first_interview=Min('interviews__scheduled_at'))
            .values_list('applied_date', 'first_interview')
        )
        waits = [
            (timezone.localtime(first).date() - applied).days
            for applied, first in first_interviews
            if timezone.localtime(first).date() >= applied
        ]

        outcome_counts = dict(
            interviews.order_by().values_list('outcome').annotate(count=Count('id'))
        )

        return Response({
            "range": range_key,
            "total": total,
            "submitted": submitted,
            "by_status": by_status,
            "monthly": monthly,
            "daily": daily,
            "this_month": month_counts.get(this_month, 0),
            "last_month": month_counts.get(last_month, 0),
            "top_companies": top('company_name'),
            "top_roles": top('job_role'),
            "top_locations": top('location'),
            "rates": {
                "response_rate": _percentage(responded, submitted),
                "interview_rate": _percentage(reached_interview, submitted),
                "selection_rate": _percentage(selected, submitted),
                "rejection_rate": _percentage(rejected, submitted),
            },
            "responded": responded,
            "reached_interview": reached_interview,
            "avg_days_to_interview": (
                round(sum(waits) / len(waits), 1) if waits else None
            ),
            "interviews": {
                "total": interviews.count(),
                "upcoming": interviews.filter(
                    scheduled_at__gte=timezone.now(),
                    outcome='Scheduled',
                ).count(),
                "by_outcome": [
                    {"outcome": value, "count": outcome_counts.get(value, 0)}
                    for value, _label in Interview.OUTCOME_CHOICES
                ],
            },
        })
