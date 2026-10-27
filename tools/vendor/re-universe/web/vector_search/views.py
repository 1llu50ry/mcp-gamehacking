"""Django views for Vector Search functionality."""

import json
import logging
from django.shortcuts import render
from django.http import JsonResponse, HttpResponseBadRequest
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.views.generic import TemplateView
from django.utils.decorators import method_decorator
from django.conf import settings

from .client import sync_vector_search, sync_health_check, sync_get_metrics, sync_generate_embeddings

logger = logging.getLogger(__name__)


class VectorSearchView(TemplateView):
    """Main vector search interface view."""
    template_name = 'vector_search/search.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        # Get vector search service status
        health_status = sync_health_check()
        context['vector_search_available'] = health_status.get('status') == 'healthy'
        context['vector_search_status'] = health_status

        # Get metrics if available
        if context['vector_search_available']:
            try:
                metrics = sync_get_metrics()
                context['metrics'] = metrics
            except Exception as e:
                logger.warning(f"Failed to get vector search metrics: {e}")
                context['metrics'] = {}

        return context


@csrf_exempt
@require_http_methods(["POST"])
def api_search(request):
    """API endpoint for vector search."""
    try:
        if request.content_type == 'application/json':
            data = json.loads(request.body)
        else:
            data = request.POST.dict()

        query = data.get('query', '').strip()
        if not query:
            return JsonResponse({'error': 'Query parameter is required'}, status=400)

        limit = int(data.get('limit', 20))
        threshold = float(data.get('threshold', 0.7))
        use_cache = data.get('use_cache', True)

        # Validate parameters
        if limit < 1 or limit > 100:
            return JsonResponse({'error': 'Limit must be between 1 and 100'}, status=400)

        if threshold < 0.0 or threshold > 1.0:
            return JsonResponse({'error': 'Threshold must be between 0.0 and 1.0'}, status=400)

        # Perform search
        search_result = sync_vector_search(query, limit, threshold, use_cache)

        if 'error' in search_result:
            return JsonResponse(search_result, status=500)

        return JsonResponse(search_result)

    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON data'}, status=400)
    except ValueError as e:
        return JsonResponse({'error': f'Invalid parameter: {str(e)}'}, status=400)
    except Exception as e:
        logger.error(f"Vector search API error: {str(e)}")
        return JsonResponse({'error': 'Search request failed'}, status=500)


@require_http_methods(["GET"])
def api_health(request):
    """API endpoint for vector search service health check."""
    try:
        health_status = sync_health_check()
        status_code = 200 if health_status.get('status') == 'healthy' else 503
        return JsonResponse(health_status, status=status_code)
    except Exception as e:
        logger.error(f"Health check API error: {str(e)}")
        return JsonResponse({'error': 'Health check failed'}, status=500)


@require_http_methods(["GET"])
def api_metrics(request):
    """API endpoint for vector search service metrics."""
    try:
        metrics = sync_get_metrics()

        if 'error' in metrics:
            return JsonResponse(metrics, status=500)

        return JsonResponse(metrics)
    except Exception as e:
        logger.error(f"Metrics API error: {str(e)}")
        return JsonResponse({'error': 'Metrics request failed'}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def api_generate_embeddings(request):
    """API endpoint for generating embeddings."""
    try:
        if request.content_type == 'application/json':
            data = json.loads(request.body)
        else:
            data = request.POST.dict()

        function_ids = data.get('function_ids', [])
        if isinstance(function_ids, str):
            # Handle comma-separated string
            function_ids = [int(x.strip()) for x in function_ids.split(',') if x.strip()]

        if not function_ids:
            return JsonResponse({'error': 'function_ids parameter is required'}, status=400)

        force_regenerate = data.get('force_regenerate', False)

        # Validate function IDs
        try:
            function_ids = [int(fid) for fid in function_ids]
        except ValueError:
            return JsonResponse({'error': 'All function_ids must be integers'}, status=400)

        if len(function_ids) > 1000:
            return JsonResponse({'error': 'Maximum 1000 function IDs per request'}, status=400)

        # Generate embeddings
        result = sync_generate_embeddings(function_ids, force_regenerate)

        if 'error' in result:
            return JsonResponse(result, status=500)

        return JsonResponse(result)

    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON data'}, status=400)
    except Exception as e:
        logger.error(f"Embedding generation API error: {str(e)}")
        return JsonResponse({'error': 'Embedding generation failed'}, status=500)


def search_results(request):
    """Render search results page."""
    query = request.GET.get('q', '').strip()
    limit = min(int(request.GET.get('limit', 20)), 100)
    threshold = float(request.GET.get('threshold', 0.7))

    context = {
        'query': query,
        'limit': limit,
        'threshold': threshold,
        'results': [],
        'error': None,
        'search_time': 0,
        'result_count': 0
    }

    if query:
        try:
            # Perform vector search
            search_result = sync_vector_search(query, limit, threshold)

            if 'error' in search_result:
                context['error'] = search_result['error']
            else:
                context.update({
                    'results': search_result.get('results', []),
                    'search_time': search_result.get('search_time_ms', 0),
                    'result_count': search_result.get('result_count', 0),
                    'cached': search_result.get('cached', False),
                    'similarity_threshold': search_result.get('similarity_threshold', threshold)
                })

        except Exception as e:
            logger.error(f"Search results error: {str(e)}")
            context['error'] = 'Search request failed'

    return render(request, 'vector_search/results.html', context)


def function_detail_with_similar(request, function_id):
    """Function detail page enhanced with similar functions."""
    from bsim.models import DesctableProxy  # Assuming this exists

    try:
        function = DesctableProxy.objects.get(id=function_id)
    except DesctableProxy.DoesNotExist:
        return render(request, '404.html', status=404)

    context = {
        'function': function,
        'similar_functions': [],
        'search_available': False,
        'search_error': None
    }

    # Try to find similar functions using vector search
    try:
        health_status = sync_health_check()
        if health_status.get('status') == 'healthy':
            # Create search query based on function name
            if function.name_func:
                search_query = f"function similar to {function.name_func}"
                search_result = sync_vector_search(search_query, limit=10, threshold=0.6)

                if 'results' in search_result:
                    # Filter out the current function from results
                    similar = [r for r in search_result['results']
                              if r['function_id'] != function_id]
                    context['similar_functions'] = similar[:5]  # Top 5 similar
                    context['search_available'] = True

        else:
            context['search_error'] = 'Vector search service unavailable'

    except Exception as e:
        logger.warning(f"Failed to get similar functions for {function_id}: {str(e)}")
        context['search_error'] = 'Failed to find similar functions'

    return render(request, 'vector_search/function_detail.html', context)


@method_decorator(csrf_exempt, name='dispatch')
class VectorSearchStatusView(TemplateView):
    """Vector search service status and administration view."""
    template_name = 'vector_search/status.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        try:
            # Get health status
            health_status = sync_health_check()
            context['health_status'] = health_status
            context['service_healthy'] = health_status.get('status') == 'healthy'

            # Get metrics if service is healthy
            if context['service_healthy']:
                metrics = sync_get_metrics()
                context['metrics'] = metrics

                # Calculate additional statistics
                total_functions = metrics.get('total_functions', 0)
                functions_with_embeddings = metrics.get('functions_with_embeddings', 0)

                context['embedding_stats'] = {
                    'total_functions': total_functions,
                    'functions_with_embeddings': functions_with_embeddings,
                    'functions_without_embeddings': total_functions - functions_with_embeddings,
                    'coverage_percent': metrics.get('embedding_coverage_percent', 0)
                }

        except Exception as e:
            logger.error(f"Failed to get vector search status: {str(e)}")
            context['error'] = str(e)

        return context