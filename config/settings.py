"""
Django settings for the JobTrack project.

Everything that differs between a developer laptop and production (secrets,
debug mode, hosts, database) is read from environment variables, which are
loaded from the .env file during local development. See .env.example.
"""

import os
import sys
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def env_list(name, default=""):
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


TESTING = "test" in sys.argv

# ---------------------------------------------------------------
# Core
# ---------------------------------------------------------------

# Local development default is True. Production must set DJANGO_DEBUG=False.
DEBUG = env_bool("DJANGO_DEBUG", True)

# Development-only fallback key. It is public (it was in this file), so it
# is refused as soon as DEBUG is off.
_DEV_SECRET_KEY = 'django-insecure-ih!p2r&tmr!-zqjd8#zd9us=9yl-^n-9703eup8@izl97t%cf%'

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY") or (_DEV_SECRET_KEY if DEBUG else "")

if not SECRET_KEY:
    raise ImproperlyConfigured(
        "Set the DJANGO_SECRET_KEY environment variable when DJANGO_DEBUG is False."
    )

# Optional dedicated key for encrypting Gmail tokens (a Fernet key).
# When empty, a key is derived from SECRET_KEY.
TOKEN_ENCRYPTION_KEY = os.getenv("TOKEN_ENCRYPTION_KEY", "")

ALLOWED_HOSTS = env_list(
    "DJANGO_ALLOWED_HOSTS",
    "localhost,127.0.0.1" if DEBUG else "",
)

# Where the React app is served. Used for the redirect after Gmail OAuth.
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'corsheaders',
    'rest_framework',
    'jobs',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

if not DEBUG:
    # WhiteNoise serves the admin's CSS/JS in production without a separate
    # static file server. In development Django's runserver does that.
    MIDDLEWARE.insert(1, 'whitenoise.middleware.WhiteNoiseMiddleware')

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# ---------------------------------------------------------------
# REST API and authentication
# ---------------------------------------------------------------

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        # JWT read from an HttpOnly cookie (see jobs/authentication.py).
        'jobs.authentication.CookieJWTAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    # Every endpoint requires login unless it says otherwise.
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    # Rate limits for the two endpoints anyone can call without logging in.
    'DEFAULT_THROTTLE_RATES': {
        'login': os.getenv("THROTTLE_LOGIN", "20/min"),
        'register': os.getenv("THROTTLE_REGISTER", "20/hour"),
    },
}

SIMPLE_JWT = {
    # Short-lived access token; the refresh token silently renews it.
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=30),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
}

# Login cookies are marked "Secure" (https only) once the site uses https.
AUTH_COOKIE_SECURE = env_bool("USE_HTTPS", False)

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", FRONTEND_URL)
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", FRONTEND_URL)

# ---------------------------------------------------------------
# Database
# ---------------------------------------------------------------

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.getenv('DB_NAME'),
        'USER': os.getenv('DB_USER'),
        'PASSWORD': os.getenv('DB_PASSWORD'),
        'HOST': os.getenv('DB_HOST'),
        'PORT': os.getenv('DB_PORT'),
    }
}

# `python manage.py test` creates a throwaway database. That needs the
# CREATEDB privilege in PostgreSQL, so tests default to in-memory SQLite.
# Set TEST_DATABASE=postgres to run them against PostgreSQL instead.
if TESTING and os.getenv("TEST_DATABASE", "sqlite") == "sqlite":
    DATABASES['default'] = {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }

if TESTING:
    # Fast (insecure) hashing so the test suite is quick.
    PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']

# ---------------------------------------------------------------
# Password validation
# ---------------------------------------------------------------

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

# ---------------------------------------------------------------
# Internationalization
# ---------------------------------------------------------------

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True

# ---------------------------------------------------------------
# Static files (Django admin)
# ---------------------------------------------------------------

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# ---------------------------------------------------------------
# Production security (active only when DEBUG is off)
# ---------------------------------------------------------------

if not DEBUG:
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = 'DENY'

    # Turn on once the site is served over HTTPS.
    if env_bool("USE_HTTPS", False):
        # The reverse proxy (nginx / hosting platform) terminates TLS and
        # tells Django the original request was https.
        SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
        SECURE_SSL_REDIRECT = True
        SESSION_COOKIE_SECURE = True
        CSRF_COOKIE_SECURE = True
        SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
        SECURE_HSTS_INCLUDE_SUBDOMAINS = True

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'root': {'handlers': ['console'], 'level': 'INFO'},
    'loggers': {
        # Expected 4xx responses would otherwise flood the test output.
        'django.request': {'level': 'ERROR' if TESTING else 'WARNING'},
    },
}
