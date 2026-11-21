"""
Encryption for secrets stored in the database (Gmail OAuth tokens).

Fernet is symmetric encryption: the same key encrypts and decrypts. The key
never goes in the database, so a leaked database dump alone does not expose
anyone's Gmail access.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import models

# Marks a stored value as encrypted, so rows saved before encryption was
# added (plain text) can still be read and upgraded.
PREFIX = "enc::"


def _fernet():
    key = getattr(settings, "TOKEN_ENCRYPTION_KEY", "")

    if key:
        return Fernet(key.encode())

    # No dedicated key configured: derive one from SECRET_KEY.
    digest = hashlib.sha256(settings.SECRET_KEY.encode()).digest()

    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value):
    if not value or value.startswith(PREFIX):
        return value

    return PREFIX + _fernet().encrypt(value.encode()).decode()


def decrypt(value):
    if not value or not value.startswith(PREFIX):
        return value

    try:
        return _fernet().decrypt(value[len(PREFIX):].encode()).decode()
    except InvalidToken:
        # The key changed. The token is unreadable, which the Gmail code
        # treats as "please connect again".
        return ""


class EncryptedTextField(models.TextField):
    """A TextField that is encrypted in the database and plain in Python."""

    def from_db_value(self, value, expression, connection):
        return decrypt(value)

    def get_prep_value(self, value):
        return encrypt(super().get_prep_value(value))
