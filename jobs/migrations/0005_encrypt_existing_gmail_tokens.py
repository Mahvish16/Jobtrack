from django.db import migrations


def encrypt_tokens(apps, schema_editor):
    """Gmail tokens saved before encryption was added are plain text.
    Reading a row returns the plain value, and saving it writes the
    encrypted form (see jobs/crypto.py), so re-saving upgrades the row."""
    GmailConnection = apps.get_model('jobs', 'GmailConnection')

    for connection in GmailConnection.objects.all():
        connection.save(update_fields=['token', 'refresh_token'])


class Migration(migrations.Migration):

    dependencies = [
        ('jobs', '0004_interviews_tracking_encryption'),
    ]

    operations = [
        # Nothing to undo: encrypted rows stay readable.
        migrations.RunPython(encrypt_tokens, migrations.RunPython.noop),
    ]
