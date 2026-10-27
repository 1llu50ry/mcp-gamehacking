from django.urls import path
from . import views

app_name = "bsim"

urlpatterns = [
    path("", views.database_info, name="database_info"),
    path("executables/", views.executables, name="executables"),
    path(
        "executables/<int:exe_id>/", views.executable_detail, name="executable_detail"
    ),
    path("search/", views.search_functions, name="search_functions"),
    # API endpoints
    path("api/executables/", views.api_executables, name="api_executables"),
    path("api/functions/<int:exe_id>/", views.api_functions, name="api_functions"),
]
