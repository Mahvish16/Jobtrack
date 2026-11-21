from django.contrib.auth.models import User
from django.db import models

from .crypto import EncryptedTextField


class Job(models.Model):

    STATUS_CHOICES = [
        ('Interested', 'Interested'),
        ('Applied', 'Applied'),
        ('Interview', 'Interview'),
        ('Selected', 'Selected'),
        ('Rejected', 'Rejected'),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='jobs'
    )
    company_name = models.CharField(max_length=150)
    job_role = models.CharField(max_length=150)
    location = models.CharField(max_length=150, blank=True)
    salary = models.IntegerField(null=True, blank=True)
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='Applied'
    )
    applied_date = models.DateField()
    description = models.TextField(blank=True)

    # Optional extras used by the details view, calendar and reminders.
    job_url = models.URLField(max_length=500, blank=True)
    follow_up_date = models.DateField(null=True, blank=True)
    deadline = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-applied_date', '-created_at']

    def __str__(self):
        return f"{self.company_name} - {self.job_role}"


class Interview(models.Model):
    """One interview round for a job application.

    An interview has no user column of its own: it belongs to a Job, and the
    Job belongs to a User. Ownership is always checked through job.user.
    """

    TYPE_CHOICES = [
        ('Phone', 'Phone'),
        ('Video', 'Video'),
        ('Onsite', 'On-site'),
        ('Assessment', 'Assessment'),
    ]

    OUTCOME_CHOICES = [
        ('Scheduled', 'Scheduled'),
        ('Completed', 'Completed'),
        ('Passed', 'Passed'),
        ('Failed', 'Failed'),
        ('Cancelled', 'Cancelled'),
    ]

    job = models.ForeignKey(
        Job,
        on_delete=models.CASCADE,
        related_name='interviews'
    )
    round_name = models.CharField(max_length=100)
    interview_type = models.CharField(
        max_length=20,
        choices=TYPE_CHOICES,
        default='Video'
    )
    scheduled_at = models.DateTimeField()
    meeting_link = models.URLField(max_length=500, blank=True)
    location = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    outcome = models.CharField(
        max_length=20,
        choices=OUTCOME_CHOICES,
        default='Scheduled'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['scheduled_at']

    def __str__(self):
        return f"{self.job.company_name} - {self.round_name}"


class GmailConnection(models.Model):
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='gmail_connection'
    )
    # Encrypted at rest (see jobs/crypto.py).
    token = EncryptedTextField()
    refresh_token = EncryptedTextField(blank=True)
    token_uri = models.URLField()
    scopes = models.JSONField(default=list)
    expiry = models.DateTimeField(null=True, blank=True)
    connected_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} - Gmail"


class TrackedEmail(models.Model):
    """Remembers which Gmail messages a user has already dealt with.

    This is what prevents duplicates: a message that was turned into an
    application, used for a status update, or dismissed is never offered
    again. Only the Gmail message ID is stored, not the email itself.
    """

    ACTION_CHOICES = [
        ('tracked', 'Tracked as application'),
        ('status_update', 'Used for status update'),
        ('dismissed', 'Dismissed'),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='tracked_emails'
    )
    gmail_message_id = models.CharField(max_length=100)
    # Deleting the application makes its email available again.
    job = models.ForeignKey(
        Job,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='tracked_emails'
    )
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'gmail_message_id'],
                name='unique_gmail_message_per_user'
            )
        ]

    def __str__(self):
        return f"{self.user.username} - {self.gmail_message_id} ({self.action})"
