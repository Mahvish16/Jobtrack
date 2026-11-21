from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

from jobs.auth_views import LoginView, LogoutView, RefreshView


def health(request):
    """Used by Docker and hosting platforms to check the server is up."""
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health/', health, name='health'),
    path('api/token/', LoginView.as_view(), name='token_obtain_pair'),
    path('api/token/refresh/', RefreshView.as_view(), name='token_refresh'),
    path('api/token/logout/', LogoutView.as_view(), name='token_logout'),
    path('api/', include('jobs.urls')),
]
