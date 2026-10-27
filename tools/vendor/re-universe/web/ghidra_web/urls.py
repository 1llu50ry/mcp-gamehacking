"""
URL configuration for ghidra_web project.
"""

from django.contrib import admin
from django.urls import path, include
from core.health import health_check

urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/", include("allauth.urls")),
    path("bsim/", include("bsim.urls")),
    path("health/", health_check, name="health_check"),
    path("", include("core.urls")),
]
