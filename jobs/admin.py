from django.contrib import admin

from .models import GmailConnection, Interview, Job, TrackedEmail


@admin.register(Job)
class JobAdmin(admin.ModelAdmin):
    list_display = (
        'company_name',
        'job_role',
        'user',
        'status',
        'salary',
        'applied_date',
    )

    list_filter = ('status', 'applied_date')
    search_fields = ('company_name', 'job_role')


@admin.register(Interview)
class InterviewAdmin(admin.ModelAdmin):
    list_display = (
        'job',
        'round_name',
        'interview_type',
        'scheduled_at',
        'outcome',
    )

    list_filter = ('interview_type', 'outcome')
    search_fields = ('job__company_name', 'round_name')


@admin.register(GmailConnection)
class GmailConnectionAdmin(admin.ModelAdmin):
    list_display = ('user', 'connected_at', 'expiry')

    # Tokens are secrets: never show them, even to an administrator.
    exclude = ('token', 'refresh_token')
    readonly_fields = ('user', 'token_uri', 'scopes', 'expiry', 'connected_at')


@admin.register(TrackedEmail)
class TrackedEmailAdmin(admin.ModelAdmin):
    list_display = ('user', 'gmail_message_id', 'action', 'job', 'created_at')
    list_filter = ('action',)
