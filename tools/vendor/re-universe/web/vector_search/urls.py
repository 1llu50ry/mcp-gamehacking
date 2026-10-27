"""URL configuration for Vector Search functionality."""

from django.urls import path
from . import views

app_name = 'vector_search'

urlpatterns = [
    # Main vector search interface
    path('', views.VectorSearchView.as_view(), name='search'),
    path('results/', views.search_results, name='results'),

    # Function detail with similar functions
    path('function/<int:function_id>/', views.function_detail_with_similar, name='function_detail'),

    # Service status and administration
    path('status/', views.VectorSearchStatusView.as_view(), name='status'),

    # API endpoints
    path('api/search/', views.api_search, name='api_search'),
    path('api/health/', views.api_health, name='api_health'),
    path('api/metrics/', views.api_metrics, name='api_metrics'),
    path('api/embeddings/generate/', views.api_generate_embeddings, name='api_generate_embeddings'),
]