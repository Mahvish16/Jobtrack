# Backend image: Django served by Gunicorn.
FROM python:3.12-slim

# No .pyc files, and logs appear immediately in `docker compose logs`.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first: this layer is cached and only rebuilt when
# requirements.txt changes, not on every code change.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY manage.py .
COPY config ./config
COPY jobs ./jobs

# Collect the Django admin's CSS/JS into /app/staticfiles (served by WhiteNoise).
RUN python manage.py collectstatic --noinput

# Do not run the server as root.
RUN useradd --create-home appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

# Apply database migrations, then start the server.
# One worker with threads: the Gmail OAuth step and the rate limiter keep
# short-lived data in the in-process cache, which separate worker processes
# would not share. Use a shared cache (e.g. Redis) before adding workers.
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 1 --threads 4"]
