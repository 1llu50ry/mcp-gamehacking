from django.shortcuts import render, get_object_or_404
from django.core.paginator import Paginator
from django.http import JsonResponse
from django.db import connection

from .models import Exetable, Desctable, Keyvaluetable


def executables(request):
    """
    List all executables in BSim database - public view.
    """
    exe_list = Exetable.objects.all()

    # Filter by search query
    query = request.GET.get("q", "")
    if query:
        exe_list = exe_list.filter(name_exec__icontains=query)

    # Filter by architecture
    arch = request.GET.get("arch")
    if arch:
        exe_list = exe_list.filter(architecture=arch)

    paginator = Paginator(exe_list, 50)
    page = request.GET.get("page", 1)
    executables = paginator.get_page(page)

    # Get available architectures for filter
    architectures = Exetable.objects.values_list("architecture", flat=True).distinct()

    context = {
        "executables": executables,
        "query": query,
        "current_arch": arch,
        "architectures": architectures,
    }
    return render(request, "bsim/executables.html", context)


def executable_detail(request, exe_id):
    """
    View executable details with its functions - public view.
    """
    executable = get_object_or_404(Exetable, id=exe_id)

    functions = Desctable.objects.filter(id_exe=executable)

    # Filter functions
    func_query = request.GET.get("func", "")
    if func_query:
        functions = functions.filter(name_func__icontains=func_query)

    paginator = Paginator(functions, 100)
    page = request.GET.get("page", 1)
    funcs = paginator.get_page(page)

    context = {
        "executable": executable,
        "functions": funcs,
        "func_query": func_query,
        "function_count": functions.count(),
    }
    return render(request, "bsim/executable_detail.html", context)


def database_info(request):
    """
    Display BSim database configuration - public view.
    """
    try:
        config = {item.key: item.value for item in Keyvaluetable.objects.all()}
    except Exception as e:
        config = {"error": str(e)}

    # Get database statistics
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM exetable")
            exe_count = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM desctable")
            func_count = cursor.fetchone()[0]
    except Exception as e:
        exe_count = "N/A"
        func_count = "N/A"

    context = {
        "config": config,
        "exe_count": exe_count,
        "func_count": func_count,
        "template": config.get("template", "unknown"),
        "k_value": config.get("k", "unknown"),
        "l_value": config.get("L", "unknown"),
    }
    return render(request, "bsim/database_info.html", context)


def search_functions(request):
    """
    Search for functions across all executables - public view.
    """
    query = request.GET.get("q", "")
    functions = []

    if len(query) >= 3:
        functions = Desctable.objects.filter(name_func__icontains=query).select_related(
            "id_exe"
        )[:100]

    context = {
        "query": query,
        "functions": functions,
    }
    return render(request, "bsim/search_functions.html", context)


def api_executables(request):
    """
    API endpoint - list executables as JSON.
    """
    exe_list = Exetable.objects.values(
        "id", "md5", "name_exec", "architecture", "ingest_date"
    )[:100]

    return JsonResponse({"executables": list(exe_list)})


def api_functions(request, exe_id):
    """
    API endpoint - list functions for an executable as JSON.
    """
    functions = Desctable.objects.filter(id_exe_id=exe_id).values(
        "id", "name_func", "address", "flags"
    )[:500]

    return JsonResponse({"functions": list(functions)})
