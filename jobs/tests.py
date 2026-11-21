"""
Automated tests for the JobTrack API.

Run with:  python manage.py test

APITestCase gives every test an empty database and rolls it back afterwards,
so tests never see each other's data and never touch the real database.
"""

from datetime import date, timedelta
from unittest.mock import MagicMock, patch

from django.contrib.auth.models import User
from django.core.cache import cache
from django.db import connection
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from google.auth.exceptions import RefreshError
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from .authentication import ACCESS_COOKIE, REFRESH_COOKIE
from .crypto import PREFIX, decrypt, encrypt
from .gmail_parsing import (
    analyse_email,
    classify_email,
    clean_snippet,
    extract_body,
    extract_company,
    extract_details_from_body,
    extract_role,
    is_application_email,
    parse_sender,
    suggest_status_update,
)
from .models import GmailConnection, Interview, Job, TrackedEmail

PASSWORD = "Tr4ck-zebra-91!x"


def make_user(username="asha"):
    return User.objects.create_user(
        username=username, email=f"{username}@example.com", password=PASSWORD
    )


def make_job(user, **overrides):
    data = {
        "company_name": "Acme Corp",
        "job_role": "Python Developer",
        "status": "Applied",
        "applied_date": date(2026, 11, 10),
    }
    data.update(overrides)

    return Job.objects.create(user=user, **data)


class BaseAPITest(APITestCase):
    def setUp(self):
        # Rate-limit counters live in the cache; start each test clean.
        cache.clear()

        self.user = make_user("asha")
        self.other = make_user("ravi")
        self.client.force_authenticate(self.user)


# ---------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------

class RegistrationTests(APITestCase):
    def setUp(self):
        cache.clear()

    def register(self, **overrides):
        data = {
            "username": "newuser",
            "email": "new@example.com",
            "password": PASSWORD,
        }
        data.update(overrides)

        return self.client.post("/api/register/", data)

    def test_register_creates_user_with_hashed_password(self):
        response = self.register()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertNotIn("password", response.data["user"])

        user = User.objects.get(username="newuser")

        self.assertNotEqual(user.password, PASSWORD)
        self.assertTrue(user.check_password(PASSWORD))

    def test_duplicate_username_is_rejected_case_insensitively(self):
        self.register()
        response = self.register(username="NewUser", email="b@example.com")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.data)

    def test_duplicate_email_is_rejected(self):
        self.register()
        response = self.register(username="another", email="NEW@example.com")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", response.data)

    def test_weak_password_is_rejected(self):
        for weak in ("12345678", "password", "short"):
            response = self.register(password=weak)

            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn("password", response.data)

        self.assertFalse(User.objects.exists())

    def test_email_is_required(self):
        response = self.client.post(
            "/api/register/", {"username": "x", "password": PASSWORD}
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", response.data)

    def test_registration_is_rate_limited(self):
        with patch.dict(
            "rest_framework.throttling.ScopedRateThrottle.THROTTLE_RATES",
            {"register": "2/min"},
        ):
            self.register(username="u1", email="u1@example.com")
            self.register(username="u2", email="u2@example.com")
            response = self.register(username="u3", email="u3@example.com")

        self.assertEqual(
            response.status_code, status.HTTP_429_TOO_MANY_REQUESTS
        )


class LoginTests(APITestCase):
    def setUp(self):
        cache.clear()
        make_user("asha")

    def login(self, client=None, **extra):
        return (client or self.client).post(
            "/api/token/",
            {"username": "asha", "password": PASSWORD, **extra},
            format="json",
        )

    def test_login_puts_tokens_in_httponly_cookies_not_in_the_body(self):
        response = self.login()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # JavaScript receives no token at all...
        self.assertNotIn("access", response.data)
        self.assertNotIn("refresh", response.data)

        # ...they are in cookies the page's scripts cannot read.
        for name, path in ((ACCESS_COOKIE, "/api/"), (REFRESH_COOKIE, "/api/token/")):
            cookie = response.cookies[name]

            self.assertTrue(cookie["httponly"], name)
            self.assertEqual(cookie["samesite"], "Lax")
            self.assertEqual(cookie["path"], path)
            self.assertGreater(len(cookie.value), 50)

        self.assertIn("csrftoken", response.cookies)

    def test_remember_me_controls_how_long_the_cookies_live(self):
        remembered = self.login(remember=True)

        self.assertEqual(remembered.cookies[ACCESS_COOKIE]["max-age"], 7 * 24 * 3600)

        # Not remembered: a session cookie, gone when the browser closes.
        session_only = self.login(remember=False)

        self.assertEqual(session_only.cookies[ACCESS_COOKIE]["max-age"], "")
        self.assertEqual(session_only.cookies[REFRESH_COOKIE]["max-age"], "")

    def test_cookies_are_secure_when_the_site_uses_https(self):
        self.assertFalse(self.login().cookies[ACCESS_COOKIE]["secure"])

        with self.settings(AUTH_COOKIE_SECURE=True):
            self.assertTrue(self.login().cookies[ACCESS_COOKIE]["secure"])

    def test_wrong_password_is_rejected(self):
        response = self.client.post(
            "/api/token/", {"username": "asha", "password": "wrong"}
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertNotIn(ACCESS_COOKIE, response.cookies)

    def test_cookie_authenticates_requests(self):
        # The test client keeps cookies between requests, like a browser.
        self.login()
        response = self.client.get("/api/me/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["username"], "asha")
        self.assertFalse(response.data["gmail_connected"])

    def test_refresh_issues_a_new_access_cookie(self):
        self.login(remember=False)
        del self.client.cookies[ACCESS_COOKIE]  # as if it had expired

        self.assertEqual(self.client.get("/api/me/").status_code, 401)

        response = self.client.post("/api/token/refresh/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn("access", response.data)
        # The "do not remember me" choice survives the refresh.
        self.assertEqual(response.cookies[ACCESS_COOKIE]["max-age"], "")
        self.assertEqual(self.client.get("/api/me/").status_code, 200)

    def test_refresh_fails_without_a_valid_cookie(self):
        self.assertEqual(self.client.post("/api/token/refresh/").status_code, 401)

        self.client.cookies[REFRESH_COOKIE] = "not-a-real-token"

        self.assertEqual(self.client.post("/api/token/refresh/").status_code, 401)

    def test_refresh_fails_after_the_account_is_deleted(self):
        self.login()
        User.objects.filter(username="asha").delete()

        self.assertEqual(self.client.post("/api/token/refresh/").status_code, 401)

    def test_an_access_token_cannot_be_used_as_a_refresh_token(self):
        self.login()
        self.client.cookies[REFRESH_COOKIE] = self.client.cookies[ACCESS_COOKIE].value

        self.assertEqual(self.client.post("/api/token/refresh/").status_code, 401)

    def test_invalid_token_is_rejected(self):
        self.client.cookies[ACCESS_COOKIE] = "not-a-real-token"

        self.assertEqual(
            self.client.get("/api/jobs/").status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_token_in_a_header_is_not_accepted(self):
        token = self.login().cookies[ACCESS_COOKIE].value
        other = APIClient()
        other.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

        self.assertEqual(other.get("/api/me/").status_code, 401)

    def test_logout_clears_the_cookies(self):
        self.login()

        response = self.client.post("/api/token/logout/")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(response.cookies[ACCESS_COOKIE].value, "")
        self.assertEqual(self.client.get("/api/me/").status_code, 401)

    def test_changing_data_requires_the_csrf_token(self):
        """The cookie alone is not enough to change data. A request from
        another website would carry the cookie but not this token."""
        browser = APIClient(enforce_csrf_checks=True)
        self.login(browser)
        job = {
            "company_name": "Acme", "job_role": "Dev",
            "applied_date": "2026-11-01",
        }

        # Reading is allowed...
        self.assertEqual(browser.get("/api/jobs/").status_code, 200)

        # ...writing without the token is refused...
        response = browser.post("/api/jobs/", job, format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Job.objects.exists())

        # ...and works when the token from the cookie is sent in the header.
        response = browser.post(
            "/api/jobs/", job, format="json",
            HTTP_X_CSRFTOKEN=browser.cookies["csrftoken"].value,
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_protected_endpoints_require_login(self):
        for url in (
            "/api/jobs/",
            "/api/interviews/",
            "/api/analytics/",
            "/api/me/",
            "/api/gmail/connect/",
            "/api/gmail/connection/",
            "/api/gmail/messages/",
            "/api/gmail/messages/m1/",
        ):
            self.assertEqual(
                self.client.get(url).status_code,
                status.HTTP_401_UNAUTHORIZED,
                url,
            )

    def test_health_check_is_public(self):
        self.assertEqual(self.client.get("/api/health/").status_code, 200)


# ---------------------------------------------------------------
# Profile (edit, change password, delete account)
# ---------------------------------------------------------------

class ProfileTests(BaseAPITest):
    def test_register_saves_first_name(self):
        self.client.force_authenticate(None)
        self.client.post("/api/register/", {
            "username": "newbie", "first_name": "Asha",
            "email": "newbie@example.com", "password": PASSWORD,
        })

        self.assertEqual(User.objects.get(username="newbie").first_name, "Asha")

    def test_me_returns_profile(self):
        data = self.client.get("/api/me/").data

        self.assertEqual(data["username"], "asha")
        self.assertEqual(data["email"], "asha@example.com")
        self.assertIn("first_name", data)
        self.assertNotIn("password", data)

    def test_update_name_and_email(self):
        response = self.client.patch("/api/me/", {
            "first_name": "Asha", "last_name": "Rao",
            "email": "Asha.Rao@Example.com",
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.user.refresh_from_db()

        self.assertEqual(self.user.first_name, "Asha")
        self.assertEqual(self.user.email, "asha.rao@example.com")

    def test_username_cannot_be_changed(self):
        self.client.patch("/api/me/", {"username": "hacker"})
        self.user.refresh_from_db()

        self.assertEqual(self.user.username, "asha")

    def test_email_must_be_unique_and_valid(self):
        for bad in ("RAVI@example.com", "not-an-email", ""):
            response = self.client.patch("/api/me/", {"email": bad})

            self.assertEqual(
                response.status_code, status.HTTP_400_BAD_REQUEST, bad
            )

        # Saving your own unchanged email is fine.
        response = self.client.patch("/api/me/", {"email": "asha@example.com"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_change_password(self):
        new_password = "N3w-giraffe-55!q"

        response = self.client.post("/api/me/password/", {
            "current_password": "wrong", "new_password": new_password,
        })

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("current_password", response.data)

        response = self.client.post("/api/me/password/", {
            "current_password": PASSWORD, "new_password": "12345678",
        })

        self.assertIn("new_password", response.data)

        response = self.client.post("/api/me/password/", {
            "current_password": PASSWORD, "new_password": new_password,
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.user.refresh_from_db()

        self.assertTrue(self.user.check_password(new_password))
        self.assertFalse(self.user.check_password(PASSWORD))

    def test_delete_account_requires_password(self):
        make_job(self.user)

        for payload in ({}, {"password": "wrong"}):
            response = self.client.delete("/api/me/", payload)

            self.assertEqual(
                response.status_code, status.HTTP_400_BAD_REQUEST
            )

        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

    def test_delete_account_removes_only_own_data(self):
        make_job(self.user)
        theirs = make_job(self.other)
        GmailConnection.objects.create(
            user=self.user, token="t", refresh_token="r",
            token_uri="https://oauth2.googleapis.com/token",
        )

        with patch("jobs.gmail_views.requests.post") as revoke:
            response = self.client.delete("/api/me/", {"password": PASSWORD})

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertTrue(revoke.called)
        self.assertFalse(User.objects.filter(username="asha").exists())
        self.assertFalse(Job.objects.filter(user__username="asha").exists())
        self.assertFalse(GmailConnection.objects.exists())
        self.assertTrue(Job.objects.filter(pk=theirs.pk).exists())
        self.assertTrue(User.objects.filter(username="ravi").exists())

    def test_profile_endpoints_require_login(self):
        self.client.force_authenticate(None)

        self.assertEqual(self.client.patch("/api/me/", {}).status_code, 401)
        self.assertEqual(self.client.delete("/api/me/").status_code, 401)
        self.assertEqual(
            self.client.post("/api/me/password/", {}).status_code, 401
        )


# ---------------------------------------------------------------
# Job applications
# ---------------------------------------------------------------

class JobCrudTests(BaseAPITest):
    payload = {
        "company_name": "Zeta Labs",
        "job_role": "React Engineer",
        "location": "Remote",
        "salary": 900000,
        "status": "Interested",
        "applied_date": "2026-11-15",
        "description": "Referred by a friend",
        "job_url": "https://zeta.example.com/jobs/1",
        "follow_up_date": "2026-11-22",
        "deadline": "2026-11-30",
    }

    def test_create_job_assigns_logged_in_user(self):
        response = self.client.post("/api/jobs/", self.payload)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        job = Job.objects.get(id=response.data["id"])

        self.assertEqual(job.user, self.user)
        self.assertEqual(job.status, "Interested")
        self.assertEqual(job.follow_up_date, date(2026, 11, 22))

    def test_user_field_in_payload_is_ignored(self):
        response = self.client.post(
            "/api/jobs/", {**self.payload, "user": self.other.id}
        )

        self.assertEqual(
            Job.objects.get(id=response.data["id"]).user, self.user
        )

    def test_required_fields_and_validation(self):
        response = self.client.post("/api/jobs/", {"location": "Pune"})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        for field in ("company_name", "job_role", "applied_date"):
            self.assertIn(field, response.data)

        for bad in (
            {"status": "Ghosted"},
            {"salary": -5},
            {"applied_date": "15/11/2026"},
            {"job_url": "not a url"},
        ):
            response = self.client.post("/api/jobs/", {**self.payload, **bad})

            self.assertEqual(
                response.status_code, status.HTTP_400_BAD_REQUEST, bad
            )

    def test_list_is_newest_first(self):
        make_job(self.user, company_name="Old", applied_date=date(2026, 1, 1))
        make_job(self.user, company_name="New", applied_date=date(2026, 6, 1))

        names = [job["company_name"] for job in self.client.get("/api/jobs/").data]

        self.assertEqual(names, ["New", "Old"])

    def test_update_and_partial_update(self):
        job = make_job(self.user)

        response = self.client.put(
            f"/api/jobs/{job.id}/", {**self.payload, "status": "Interview"}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        response = self.client.patch(
            f"/api/jobs/{job.id}/", {"status": "Selected"}
        )

        job.refresh_from_db()

        self.assertEqual(job.status, "Selected")
        self.assertEqual(job.company_name, "Zeta Labs")

    def test_delete(self):
        job = make_job(self.user)

        response = self.client.delete(f"/api/jobs/{job.id}/")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Job.objects.filter(id=job.id).exists())

    def test_search_filter_ordering_and_pagination(self):
        make_job(self.user, company_name="Acme", job_role="Python Developer")
        make_job(self.user, company_name="Beta", job_role="Tester", status="Rejected")
        make_job(self.user, company_name="Core", job_role="Analyst", location="Pune")

        def names(query):
            data = self.client.get(f"/api/jobs/{query}").data
            rows = data["results"] if isinstance(data, dict) else data

            return [job["company_name"] for job in rows]

        self.assertEqual(names("?search=python"), ["Acme"])
        self.assertEqual(names("?search=pune"), ["Core"])
        self.assertEqual(names("?status=Rejected"), ["Beta"])
        self.assertEqual(names("?ordering=-company_name"), ["Core", "Beta", "Acme"])

        page = self.client.get("/api/jobs/?page_size=2&ordering=company_name").data

        self.assertEqual(page["count"], 3)
        self.assertEqual(len(page["results"]), 2)
        self.assertIsNotNone(page["next"])


class JobIsolationTests(BaseAPITest):
    """A user must never see or change another user's applications."""

    def setUp(self):
        super().setUp()
        self.mine = make_job(self.user, company_name="Mine")
        self.theirs = make_job(self.other, company_name="Theirs")

    def test_list_only_returns_own_jobs(self):
        names = [job["company_name"] for job in self.client.get("/api/jobs/").data]

        self.assertEqual(names, ["Mine"])

    def test_cannot_read_update_or_delete_another_users_job(self):
        url = f"/api/jobs/{self.theirs.id}/"

        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(
            self.client.patch(url, {"status": "Rejected"}).status_code, 404
        )
        self.assertEqual(self.client.delete(url).status_code, 404)

        self.theirs.refresh_from_db()

        self.assertEqual(self.theirs.status, "Applied")

    def test_deleting_user_deletes_their_jobs(self):
        self.other.delete()

        self.assertFalse(Job.objects.filter(id=self.theirs.id).exists())
        self.assertTrue(Job.objects.filter(id=self.mine.id).exists())


# ---------------------------------------------------------------
# Interviews
# ---------------------------------------------------------------

class InterviewTests(BaseAPITest):
    def setUp(self):
        super().setUp()
        self.job = make_job(self.user)
        self.their_job = make_job(self.other, company_name="Theirs")
        self.payload = {
            "job": self.job.id,
            "round_name": "Technical Round 1",
            "interview_type": "Video",
            "scheduled_at": "2026-11-25T10:30:00Z",
            "meeting_link": "https://meet.example.com/abc",
            "notes": "Revise Django ORM",
        }

    def test_create_interview(self):
        response = self.client.post("/api/interviews/", self.payload)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["company_name"], "Acme Corp")
        self.assertEqual(response.data["job_role"], "Python Developer")
        self.assertEqual(response.data["outcome"], "Scheduled")

    def test_validation(self):
        for bad in (
            {"round_name": ""},
            {"interview_type": "Telepathy"},
            {"outcome": "Maybe"},
            {"scheduled_at": "tomorrow"},
            {"meeting_link": "not a url"},
        ):
            response = self.client.post(
                "/api/interviews/", {**self.payload, **bad}
            )

            self.assertEqual(
                response.status_code, status.HTTP_400_BAD_REQUEST, bad
            )

    def test_cannot_attach_interview_to_another_users_job(self):
        response = self.client.post(
            "/api/interviews/", {**self.payload, "job": self.their_job.id}
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("job", response.data)
        self.assertFalse(Interview.objects.exists())

    def test_cannot_move_interview_to_another_users_job(self):
        interview = Interview.objects.create(
            job=self.job, round_name="HR", scheduled_at=timezone.now()
        )

        response = self.client.patch(
            f"/api/interviews/{interview.id}/", {"job": self.their_job.id}
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_isolation(self):
        theirs = Interview.objects.create(
            job=self.their_job, round_name="HR", scheduled_at=timezone.now()
        )
        Interview.objects.create(
            job=self.job, round_name="Mine", scheduled_at=timezone.now()
        )

        rounds = [row["round_name"] for row in self.client.get("/api/interviews/").data]

        self.assertEqual(rounds, ["Mine"])

        url = f"/api/interviews/{theirs.id}/"

        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.patch(url, {"notes": "x"}).status_code, 404)
        self.assertEqual(self.client.delete(url).status_code, 404)

    def test_update_delete_and_ordering(self):
        now = timezone.now()
        later = Interview.objects.create(
            job=self.job, round_name="Later", scheduled_at=now + timedelta(days=3)
        )
        Interview.objects.create(
            job=self.job, round_name="Sooner", scheduled_at=now + timedelta(days=1)
        )

        rounds = [row["round_name"] for row in self.client.get("/api/interviews/").data]

        self.assertEqual(rounds, ["Sooner", "Later"])

        response = self.client.patch(
            f"/api/interviews/{later.id}/", {"outcome": "Passed"}
        )

        self.assertEqual(response.data["outcome"], "Passed")
        self.assertEqual(
            self.client.delete(f"/api/interviews/{later.id}/").status_code, 204
        )

    def test_deleting_job_deletes_its_interviews(self):
        Interview.objects.create(
            job=self.job, round_name="HR", scheduled_at=timezone.now()
        )

        self.client.delete(f"/api/jobs/{self.job.id}/")

        self.assertFalse(Interview.objects.exists())


# ---------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------

class AnalyticsTests(BaseAPITest):
    def test_empty_account(self):
        data = self.client.get("/api/analytics/").data

        self.assertEqual(data["total"], 0)
        self.assertEqual(data["rates"]["interview_rate"], 0.0)
        self.assertEqual(len(data["monthly"]), 12)
        self.assertEqual(data["top_companies"], [])

    def test_counts_rates_and_isolation(self):
        this_month = timezone.localdate().replace(day=1)

        make_job(self.user, company_name="A", status="Interested", applied_date=this_month)
        make_job(self.user, company_name="A", status="Applied", applied_date=this_month)
        make_job(self.user, company_name="B", status="Interview", applied_date=this_month)
        make_job(self.user, company_name="C", status="Selected", applied_date=this_month)
        rejected = make_job(
            self.user, company_name="D", status="Rejected", applied_date=this_month
        )
        # Rejected after an interview still counts as "reached interview".
        Interview.objects.create(
            job=rejected,
            round_name="HR",
            scheduled_at=timezone.now() - timedelta(days=2),
            outcome="Failed",
        )
        Interview.objects.create(
            job=rejected,
            round_name="Future",
            scheduled_at=timezone.now() + timedelta(days=2),
        )

        # Another user's data must not leak into the numbers.
        make_job(self.other, company_name="A", status="Selected")

        data = self.client.get("/api/analytics/").data

        self.assertEqual(data["total"], 5)
        self.assertEqual(data["submitted"], 4)
        self.assertEqual(
            {row["status"]: row["count"] for row in data["by_status"]},
            {"Interested": 1, "Applied": 1, "Interview": 1, "Selected": 1, "Rejected": 1},
        )
        self.assertEqual(data["reached_interview"], 3)
        self.assertEqual(data["rates"]["interview_rate"], 75.0)
        self.assertEqual(data["rates"]["selection_rate"], 25.0)
        self.assertEqual(data["rates"]["rejection_rate"], 25.0)
        self.assertEqual(data["monthly"][-1]["count"], 5)
        self.assertEqual(sum(row["count"] for row in data["monthly"]), 5)
        self.assertEqual(data["top_companies"][0], {"company_name": "A", "count": 2})
        self.assertEqual(data["interviews"]["total"], 2)
        self.assertEqual(data["interviews"]["upcoming"], 1)

        # heard back: Interview, Selected and Rejected, out of 4 submitted
        self.assertEqual(data["responded"], 3)
        self.assertEqual(data["rates"]["response_rate"], 75.0)
        self.assertEqual(data["this_month"], 5)
        self.assertEqual(data["top_roles"][0]["job_role"], "Python Developer")
        self.assertEqual(data["top_locations"], [])

    def test_range_filter(self):
        today = timezone.localdate()

        make_job(self.user, company_name="Recent", applied_date=today - timedelta(days=5))
        make_job(self.user, company_name="Older", applied_date=today - timedelta(days=60))
        make_job(self.user, company_name="Ancient", applied_date=today - timedelta(days=400))

        def total(query):
            return self.client.get(f"/api/analytics/{query}").data["total"]

        self.assertEqual(total(""), 3)
        self.assertEqual(total("?range=all"), 3)
        self.assertEqual(total("?range=30"), 1)
        self.assertEqual(total("?range=90"), 2)
        self.assertEqual(total("?range=365"), 2)
        # An unknown value falls back to everything.
        data = self.client.get("/api/analytics/?range=banana").data

        self.assertEqual(data["total"], 3)
        self.assertEqual(data["range"], "all")

    def test_daily_activity_grid(self):
        today = timezone.localdate()

        make_job(self.user, applied_date=today)
        make_job(self.user, applied_date=today)
        make_job(self.user, applied_date=today - timedelta(days=3))
        make_job(self.user, applied_date=today - timedelta(days=200))  # too old

        daily = self.client.get("/api/analytics/").data["daily"]

        # 11 whole weeks plus this week up to today, starting on a Monday.
        self.assertEqual(date.fromisoformat(daily[0]["date"]).weekday(), 0)
        self.assertEqual(daily[-1]["date"], today.isoformat())
        self.assertEqual(len(daily), 11 * 7 + today.weekday() + 1)
        self.assertEqual(daily[-1]["count"], 2)
        self.assertEqual(daily[-4]["count"], 1)
        self.assertEqual(sum(day["count"] for day in daily), 3)

    def test_average_days_to_first_interview(self):
        self.assertIsNone(
            self.client.get("/api/analytics/").data["avg_days_to_interview"]
        )

        today = timezone.localdate()
        fast = make_job(self.user, company_name="Fast", applied_date=today - timedelta(days=10))
        slow = make_job(self.user, company_name="Slow", applied_date=today - timedelta(days=30))

        def interview(job, days_after_applying):
            Interview.objects.create(
                job=job, round_name="R",
                scheduled_at=timezone.now() - timedelta(days=(today - job.applied_date).days - days_after_applying),
            )

        interview(fast, 4)
        interview(fast, 8)   # a later round does not count
        interview(slow, 10)

        # (4 + 10) / 2
        self.assertEqual(
            self.client.get("/api/analytics/").data["avg_days_to_interview"], 7.0
        )


# ---------------------------------------------------------------
# Gmail email parsing (pure functions, no database)
# ---------------------------------------------------------------

class GmailParsingTests(SimpleTestCase):
    def test_parse_sender(self):
        self.assertEqual(
            parse_sender('"Acme Careers" <jobs@mail.acme.com>'),
            ("Acme Careers", "acme"),
        )
        self.assertEqual(parse_sender("hr@initech.co.in"), ("", "initech"))
        self.assertEqual(parse_sender(""), ("", ""))

    def test_classify(self):
        cases = {
            "Thank you for applying to Acme": "confirmation",
            "Your application was sent to Initech": "confirmation",
            "Interview invitation - Python Developer": "interview",
            "Next steps: online assessment": "interview",
            "Update on your application": "confirmation",
            "Your offer letter from Acme": "offer",
            "Weekly newsletter": "other",
        }

        for subject, expected in cases.items():
            self.assertEqual(classify_email(subject, ""), expected, subject)

        # A rejection mentions the application and the interview too.
        self.assertEqual(
            classify_email(
                "Your application to Acme",
                "Thank you for interviewing. Unfortunately we have decided "
                "to move forward with other candidates.",
            ),
            "rejection",
        )

    def test_extract_role(self):
        cases = {
            "Your application for Python Developer at Acme Corp": "Python Developer",
            "Application for the position of Data Analyst": "Data Analyst",
            "Thank you for applying for the Backend Engineer role at Initech":
                "Backend Engineer",
            "Indeed Application: Junior Django Developer": "Junior Django Developer",
            "Interview for Front-end Developer - Globex": "Front-end Developer",
            "You applied for Software Engineer II, Platform": "Software Engineer II",
            "Thank you for your interest in the QA Engineer position": "QA Engineer",
            "Application received": "",
            "Thanks for applying to a job": "",
            # "applying to" / "application to" name a company, not a role
            "Thanks for applying to H&M - here is what is next": "",
            "Application to Parsewave successfully submitted": "",
            "Priya, your application was sent to Zepto": "",
            "About your Software Development Intern application":
                "Software Development Intern",
            "Application Received: Software Engineer, Backend (1-2 years) at PhonePe":
                "Software Engineer",
            "Update on your Job Application with PhonePe for Software Engineer, Backend":
                "Software Engineer",
        }

        for subject, expected in cases.items():
            self.assertEqual(extract_role(subject, ""), expected, subject)

        self.assertEqual(
            extract_role("Application received", "You applied for Data Engineer at Acme."),
            "Data Engineer",
        )

    def test_extract_company(self):
        cases = [
            ("Your application for Python Developer at Acme Corp", "", "Indeed <no-reply@indeed.com>", "Acme Corp"),
            ("Your application was sent to Initech", "", "LinkedIn <jobs-noreply@linkedin.com>", "Initech"),
            ("Thank you for applying", "", "Globex Careers <careers@globex.com>", "Globex"),
            ("Application received", "", "no-reply@hooli.io", "Hooli"),
            ("Application received", "", "Workday <acme@myworkday.com>", ""),
            ("Application received", "", "someone@gmail.com", ""),
            ("Thank you for your interest in Umbrella", "", "Umbrella Recruiting Team <x@greenhouse.io>", "Umbrella"),
            ("TCS Walk-In Interview 2026 | Freshers | 23rd-27th Nov 2026", "", "Career For Freshers via LinkedIn <newsletters-noreply@linkedin.com>", "TCS"),
            ("Application to Parsewave successfully submitted", "", "Wellfound <team@hi.wellfound.com>", "Parsewave"),
            ("Your application was viewed by insureka", "", "LinkedIn <jobs-noreply@linkedin.com>", "insureka"),
            ("Priya, your application was sent to TSL Consulting Pvt. Ltd.", "", "LinkedIn <jobs-noreply@linkedin.com>", "TSL Consulting Pvt. Ltd"),
            ("Update on your Job Application with PhonePe for Software Engineer", "", "PhonePe Hiring Team <n@recruiting.com>", "PhonePe"),
            ("Thanks for applying to H&M - here is what is next", "", '"H&M" <notification@career.hmgroup.com>', "H&M"),
            ("Deloitte Walk-In Interview | 21st Nov 2026", "", "Career For Freshers via LinkedIn <newsletters-noreply@linkedin.com>", "Deloitte"),
            ("Infosys Off Campus Drive - 2026 batch", "", "x@linkedin.com", "Infosys"),
        ]

        for subject, snippet, sender, expected in cases:
            self.assertEqual(
                extract_company(subject, snippet, sender), expected, subject + sender
            )

    def test_analyse_email(self):
        result = analyse_email(
            "Interview invitation for Python Developer at Acme Corp",
            "Acme Talent <talent@acme.com>",
            "We would like to schedule a call.",
        )

        self.assertEqual(result, {
            "category": "interview",
            "suggested_status": "Interview",
            "suggested_company": "Acme Corp",
            "suggested_role": "Python Developer",
        })

    def test_only_emails_about_the_users_own_applications_are_kept(self):
        keep = [
            ("Thank you for applying to Acme", "Acme Careers <careers@acme.com>", ""),
            ("Your application was sent to Initech", "LinkedIn <jobs-noreply@linkedin.com>", ""),
            ("Indeed Application: Python Developer", "Indeed <no-reply@indeed.com>", "Your application has been submitted."),
            ("Interview invitation for Python Developer", "Acme Talent <talent@acme.com>", "We would like to schedule a call."),
            ("Update on your application", "hr@globex.com", "Unfortunately we will not be moving forward."),
            ("Your offer letter from Acme", "hr@acme.com", ""),
            ("Your application was viewed by insureka", "LinkedIn <jobs-noreply@linkedin.com>", ""),
            ("Application to Parsewave successfully submitted", "Wellfound <team@hi.wellfound.com>", ""),
            ("Application Received: Software Engineer at PhonePe", "PhonePe <notification@recruiting.com>",
             "We will review it and respond in due course."),
        ]
        drop = [
            # the two real examples that slipped through before
            ("[GitHub] A third-party OAuth application has been added to your account",
             "GitHub <noreply@github.com>",
             "A third-party OAuth application with user scopes was recently authorized to access your account."),
            ("TCS Walk-In Interview 2026 | Freshers | 23rd-27th Nov 2026",
             "Career For Freshers via LinkedIn <newsletters-noreply@linkedin.com>",
             "Tata Consultancy Services (TCS) is offering career opportunities for freshers..."),
            ("Deloitte Walk-In Interview | 21st Nov 2026", "x@linkedin.com", "in-person hiring drive"),
            ("30 new jobs for you: Python Developer", "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", ""),
            ("Acme is hiring a Python Developer. Apply now", "jobs@naukri.com", ""),
            ("10 tips for your job application", "Blog <news@blog.com>", ""),
            ("Your weekly digest", "Digest <digest@site.com>", "your application"),
            ("Security alert", "Google <no-reply@accounts.google.com>", "A new sign-in attempt"),
            ("Lunch on Friday?", "friend@gmail.com", "see you"),
            # more real examples: course sellers and unfinished applications
            ("Update: Confirm your application to fill the skill gap in your resume",
             "Coding School Job Bootcamp <hello@careers.school.com>", ""),
            ("Update: Confirm your application for the Data Analyst interview guide",
             "Coding School <alerts@courses.school.com>", ""),
            ("Finish your application for Junior Backend Developer", "HR <no-reply-hr@acme.com>", ""),
            ("STAR Method: Answer Job Interview Questions Like a Pro",
             "Free Online Courses With Printable Certificates <x@site.com>", ""),
            ("New jobs: Application Engineer at Acme and 3 more jobs", "Wellfound <team@hi.wellfound.com>", ""),
        ]

        for subject, sender, snippet in keep:
            self.assertTrue(is_application_email(subject, sender, snippet), subject)

        for subject, sender, snippet in drop:
            self.assertFalse(is_application_email(subject, sender, snippet), subject)

    def test_clean_snippet(self):
        self.assertEqual(
            clean_snippet("We&#39;re pleased you applied to H&amp;M \u034f \u034f \u200c  "),
            "We're pleased you applied to H&M",
        )
        self.assertEqual(clean_snippet(None), "")

    def test_details_from_a_linkedin_message(self):
        body = (
            "Your application was sent to Kumaran Systems\n\n"
            "Python/Django Developer\nKumaran Systems\nChennai\n"
            "View job: https://www.linkedin.com/comm/jobs/view/4481654550/"
            "?trackingId=abc%3D%3D&refId=xyz\n"
        )

        self.assertEqual(extract_details_from_body(body), {
            "role": "Python/Django Developer",
            "location": "Chennai",
            "job_url": "https://www.linkedin.com/jobs/view/4481654550/",
        })

        # Any other email: only a role, if the text names one.
        other = extract_details_from_body(
            "Hi Asha,\nThank you for taking the time to apply for the "
            "Junior Backend Engineer role at GoCharting."
        )

        self.assertEqual(other["role"], "Junior Backend Engineer")
        self.assertEqual(other["location"], "")
        self.assertEqual(other["job_url"], "")
        self.assertEqual(
            extract_details_from_body(""),
            {"role": "", "location": "", "job_url": ""},
        )

    def test_extract_body(self):
        import base64

        def part(mime, text, **extra):
            data = base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")
            return {"mimeType": mime, "body": {"data": data}, **extra}

        # Plain text is preferred, even when nested and listed after HTML.
        payload = {
            "mimeType": "multipart/mixed",
            "parts": [
                {"mimeType": "multipart/alternative", "parts": [
                    part("text/html", "<p>HTML version</p>"),
                    part("text/plain", "Hello Asha,\r\n\r\n\r\n\r\nYour interview is on Monday.   \r\nThanks"),
                ]},
                part("text/plain", "attachment text", filename="notes.txt"),
            ],
        }

        self.assertEqual(
            extract_body(payload),
            "Hello Asha,\n\nYour interview is on Monday.\nThanks",
        )

        # HTML only: tags, styles and scripts are removed.
        html_only = part(
            "text/html",
            "<html><head><style>p{color:red}</style></head><body>"
            "<p>Dear candidate,</p><div>We&nbsp;received your application"
            "<br>for <b>Python Developer</b>.</div><script>x()</script></body></html>",
        )

        self.assertEqual(
            extract_body(html_only),
            "Dear candidate,\nWe received your application\nfor Python Developer .",
        )

        self.assertEqual(extract_body({}), "")
        self.assertEqual(extract_body({"mimeType": "text/plain", "body": {"data": "!!"}}), "")

        long_text = extract_body(part("text/plain", "word " * 2000))

        self.assertLess(len(long_text), 4100)
        self.assertTrue(long_text.endswith("[message shortened]"))

    def test_suggest_status_update(self):
        self.assertEqual(suggest_status_update("Applied", "interview"), "Interview")
        self.assertEqual(suggest_status_update("Applied", "rejection"), "Rejected")
        self.assertEqual(suggest_status_update("Interview", "offer"), "Selected")
        self.assertEqual(suggest_status_update("Interested", "interview"), "Interview")
        # Never move an application backwards or repeat its status.
        self.assertIsNone(suggest_status_update("Interview", "confirmation"))
        self.assertIsNone(suggest_status_update("Interview", "interview"))
        self.assertIsNone(suggest_status_update("Selected", "interview"))
        self.assertIsNone(suggest_status_update("Selected", "rejection"))
        self.assertIsNone(suggest_status_update("Rejected", "interview"))
        self.assertIsNone(suggest_status_update("Applied", "other"))


# ---------------------------------------------------------------
# Gmail endpoints (Google is replaced by a mock: no network)
# ---------------------------------------------------------------

def gmail_message(message_id, subject, sender, snippet=""):
    return {
        "id": message_id,
        "subject": subject,
        "sender": sender,
        "date": "Tue, 17 Nov 2026 10:00:00 +0000",
        "received_at": timezone.now(),
        "snippet": snippet,
    }


class GmailApiTests(BaseAPITest):
    def connect(self, user=None):
        return GmailConnection.objects.create(
            user=user or self.user,
            token="access-token-123",
            refresh_token="refresh-token-456",
            token_uri="https://oauth2.googleapis.com/token",
            scopes=["https://www.googleapis.com/auth/gmail.readonly"],
        )

    def fetch(self, messages):
        with patch("jobs.gmail_views.build_gmail_service", return_value=MagicMock()), \
             patch(
                 "jobs.gmail_views.fetch_message_summaries",
                 return_value=(messages, {"resultSizeEstimate": len(messages)}),
             ):
            return self.client.get("/api/gmail/messages/")

    def test_messages_require_a_connection(self):
        response = self.client.get("/api/gmail/messages/")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "gmail_not_connected")

    def test_another_users_connection_is_not_used(self):
        self.connect(self.other)

        response = self.client.get("/api/gmail/messages/")

        self.assertEqual(response.data["code"], "gmail_not_connected")
        self.assertFalse(self.client.get("/api/gmail/connection/").data["connected"])

    def test_messages_are_parsed(self):
        self.connect()

        response = self.fetch([
            gmail_message(
                "m1",
                "Your application for Python Developer at Acme Corp",
                "Indeed <no-reply@indeed.com>",
            ),
        ])

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        email = response.data["emails"][0]

        self.assertEqual(email["suggested_company"], "Acme Corp")
        self.assertEqual(email["suggested_role"], "Python Developer")
        self.assertEqual(email["category"], "confirmation")
        self.assertIsNone(email["matching_job"])

    def test_tracking_an_email_hides_it_and_blocks_duplicates(self):
        self.connect()
        messages = [
            gmail_message("m1", "Your application for Tester at Acme Corp", "x@indeed.com"),
            gmail_message("m2", "Thank you for applying", "Globex Careers <c@globex.com>"),
        ]
        payload = {
            "company_name": "Acme Corp",
            "job_role": "Tester",
            "applied_date": "2026-11-17",
            "gmail_message_id": "m1",
        }

        response = self.client.post("/api/jobs/", payload)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertNotIn("gmail_message_id", response.data)
        self.assertTrue(
            TrackedEmail.objects.filter(
                user=self.user, gmail_message_id="m1", action="tracked"
            ).exists()
        )

        # The same email cannot become a second application...
        response = self.client.post("/api/jobs/", payload)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("gmail_message_id", response.data)
        self.assertEqual(Job.objects.filter(user=self.user).count(), 1)

        # ...and it is no longer offered in the list.
        data = self.fetch(messages).data

        self.assertEqual([email["id"] for email in data["emails"]], ["m2"])
        self.assertEqual(data["hidden_count"], 1)

    def test_adverts_and_notices_are_left_out_of_the_list(self):
        self.connect()

        data = self.fetch([
            gmail_message("m1", "Thank you for applying to Acme", "careers@acme.com"),
            gmail_message(
                "m2", "TCS Walk-In Interview 2026 | Freshers",
                "Career For Freshers via LinkedIn <newsletters-noreply@linkedin.com>",
            ),
            gmail_message(
                "m3", "[GitHub] A third-party OAuth application has been added",
                "GitHub <noreply@github.com>",
            ),
        ]).data

        self.assertEqual([email["id"] for email in data["emails"]], ["m1"])
        self.assertEqual(data["skipped_count"], 2)

    def test_tracking_is_per_user(self):
        TrackedEmail.objects.create(
            user=self.other, gmail_message_id="m1", action="tracked"
        )
        self.connect()

        data = self.fetch([gmail_message("m1", "Application received", "a@acme.com")]).data

        self.assertEqual(len(data["emails"]), 1)

    def test_status_update_suggestion_for_existing_application(self):
        self.connect()
        job = make_job(self.user, company_name="Acme Corp", status="Applied")

        email = self.fetch([
            gmail_message(
                "m9",
                "Interview invitation for Python Developer at Acme Corp",
                "Acme Talent <talent@acme.com>",
            ),
        ]).data["emails"][0]

        self.assertEqual(email["matching_job"]["id"], job.id)
        self.assertEqual(email["suggested_update"], "Interview")

        # Applying the suggestion updates the job and hides the email.
        response = self.client.patch(
            f"/api/jobs/{job.id}/",
            {"status": "Interview", "gmail_message_id": "m9"},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        job.refresh_from_db()

        self.assertEqual(job.status, "Interview")
        self.assertEqual(
            TrackedEmail.objects.get(gmail_message_id="m9").action, "status_update"
        )

    def test_full_message_text(self):
        self.assertEqual(
            self.client.get("/api/gmail/messages/m1/").data["code"],
            "gmail_not_connected",
        )

        self.connect()

        import base64

        body = base64.urlsafe_b64encode(
            b"Full text that is much longer than the short preview."
        ).decode()
        service = MagicMock()
        service.users().messages().get().execute.return_value = {
            "snippet": "Full text that is...",
            "payload": {
                "mimeType": "text/plain",
                "headers": [
                    {"name": "Subject", "value": "Interview"},
                    {"name": "From", "value": "hr@acme.com"},
                ],
                "body": {"data": body},
            },
        }

        with patch("jobs.gmail_views.build_gmail_service", return_value=service):
            response = self.client.get("/api/gmail/messages/m1/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["subject"], "Interview")
        self.assertIn("suggested_role", response.data)
        self.assertIn("suggested_job_url", response.data)
        self.assertEqual(
            response.data["body"],
            "Full text that is much longer than the short preview.",
        )

    def test_dismiss_hides_an_email(self):
        self.connect()

        response = self.client.post("/api/gmail/messages/m5/dismiss/")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        data = self.fetch([gmail_message("m5", "Application tips", "news@blog.com")]).data

        self.assertEqual(data["emails"], [])

    def test_expired_connection_asks_user_to_reconnect(self):
        self.connect()

        with patch(
            "jobs.gmail_views.build_gmail_service",
            side_effect=RefreshError("invalid_grant"),
        ):
            response = self.client.get("/api/gmail/messages/")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "gmail_reconnect")
        self.assertFalse(GmailConnection.objects.filter(user=self.user).exists())

    def test_google_failure_does_not_leak_details(self):
        self.connect()

        with patch(
            "jobs.gmail_views.build_gmail_service",
            side_effect=Exception("secret internal detail"),
        ), self.assertLogs("jobs.gmail_views", level="ERROR"):
            response = self.client.get("/api/gmail/messages/")

        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertNotIn("secret", str(response.data))

    def test_disconnect_revokes_and_deletes(self):
        self.connect()
        self.connect(self.other)

        self.assertTrue(self.client.get("/api/gmail/connection/").data["connected"])

        with patch("jobs.gmail_views.requests.post") as revoke:
            response = self.client.delete("/api/gmail/connection/")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(revoke.call_args.kwargs["params"], {"token": "refresh-token-456"})
        self.assertFalse(GmailConnection.objects.filter(user=self.user).exists())
        # Only the caller's connection is removed.
        self.assertTrue(GmailConnection.objects.filter(user=self.other).exists())

    def test_connect_returns_google_url_with_signed_state(self):
        with patch.dict("os.environ", {
            "GOOGLE_CLIENT_ID": "client-id",
            "GOOGLE_CLIENT_SECRET": "client-secret",
            "GOOGLE_REDIRECT_URI": "http://127.0.0.1:8000/api/gmail/callback/",
        }):
            response = self.client.get("/api/gmail/connect/")

        url = response.data["authorization_url"]

        self.assertIn("accounts.google.com", url)
        self.assertIn("gmail.readonly", url)
        self.assertIn("state=", url)

    def test_callback_rejects_forged_or_missing_state(self):
        self.client.force_authenticate(None)

        for query in ("", "?state=forged&code=abc", "?error=access_denied"):
            response = self.client.get(f"/api/gmail/callback/{query}")

            self.assertEqual(response.status_code, 302)
            self.assertNotIn("gmail=connected", response["Location"])

        self.assertFalse(GmailConnection.objects.exists())


# ---------------------------------------------------------------
# Token encryption
# ---------------------------------------------------------------

class TokenEncryptionTests(TestCase):
    def test_round_trip(self):
        secret = encrypt("ya29.secret-token")

        self.assertTrue(secret.startswith(PREFIX))
        self.assertNotIn("ya29", secret)
        self.assertEqual(decrypt(secret), "ya29.secret-token")

    def test_plain_legacy_values_are_still_readable(self):
        self.assertEqual(decrypt("legacy-plain-token"), "legacy-plain-token")
        self.assertEqual(decrypt(""), "")

    def test_wrong_key_returns_empty_instead_of_crashing(self):
        secret = encrypt("token")

        with self.settings(SECRET_KEY="a-completely-different-key"):
            self.assertEqual(decrypt(secret), "")

    def test_tokens_are_encrypted_in_the_database(self):
        user = make_user()
        GmailConnection.objects.create(
            user=user,
            token="plain-access-token",
            refresh_token="plain-refresh-token",
            token_uri="https://oauth2.googleapis.com/token",
        )

        # Read the raw column, bypassing the model field.
        with connection.cursor() as cursor:
            cursor.execute("SELECT token, refresh_token FROM jobs_gmailconnection")
            raw_token, raw_refresh = cursor.fetchone()

        self.assertTrue(raw_token.startswith(PREFIX))
        self.assertNotIn("plain-access-token", raw_token)
        self.assertNotIn("plain-refresh-token", raw_refresh)

        # Through the model it reads back as the original value.
        saved = GmailConnection.objects.get(user=user)

        self.assertEqual(saved.token, "plain-access-token")
        self.assertEqual(saved.refresh_token, "plain-refresh-token")
