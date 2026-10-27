from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.core.paginator import Paginator

from .models import Comment, Analysis


def index(request):
    """
    Main dashboard - public view with optional login features.
    """
    # Get recent comments (public)
    recent_comments = Comment.objects.filter(
        is_deleted=False, parent__isnull=True  # Top-level comments only
    ).select_related("user")[:10]

    # Get recent analyses (public)
    recent_analyses = Analysis.objects.filter(status="completed").select_related(
        "user"
    )[:10]

    context = {
        "recent_comments": recent_comments,
        "recent_analyses": recent_analyses,
        "user_authenticated": request.user.is_authenticated,
    }
    return render(request, "core/index.html", context)


def discussion(request):
    """
    Discussion board - public view, authenticated users can post.
    """
    # Get all top-level comments with pagination
    comments_list = (
        Comment.objects.filter(
            is_deleted=False, parent__isnull=True, entity_type="general"
        )
        .select_related("user")
        .prefetch_related("replies")
    )

    paginator = Paginator(comments_list, 20)
    page = request.GET.get("page", 1)
    comments = paginator.get_page(page)

    context = {
        "comments": comments,
        "can_post": request.user.is_authenticated,
    }
    return render(request, "core/discussion.html", context)


@login_required
def post_comment(request):
    """
    Post a new comment (authenticated users only).
    """
    if request.method == "POST":
        content = request.POST.get("content", "").strip()
        entity_type = request.POST.get("entity_type", "general")
        entity_id = request.POST.get("entity_id", "")
        entity_name = request.POST.get("entity_name", "")
        parent_id = request.POST.get("parent_id")

        if not content:
            messages.error(request, "Comment content cannot be empty.")
            return redirect(request.META.get("HTTP_REFERER", "/"))

        parent = None
        if parent_id:
            parent = get_object_or_404(Comment, id=parent_id)

        comment = Comment.objects.create(
            user=request.user,
            content=content,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            parent=parent,
        )

        messages.success(request, "Comment posted successfully!")

        # Handle AJAX requests
        if request.headers.get("X-Requested-With") == "XMLHttpRequest":
            return JsonResponse(
                {
                    "success": True,
                    "comment_id": comment.id,
                    "content_html": comment.content_html,
                }
            )

        return redirect(request.META.get("HTTP_REFERER", "/"))

    return redirect("/")


@login_required
def edit_comment(request, comment_id):
    """
    Edit an existing comment (owner only).
    """
    comment = get_object_or_404(Comment, id=comment_id)

    # Check ownership
    if comment.user != request.user and not request.user.is_staff:
        messages.error(request, "You can only edit your own comments.")
        return redirect(request.META.get("HTTP_REFERER", "/"))

    if request.method == "POST":
        content = request.POST.get("content", "").strip()

        if not content:
            messages.error(request, "Comment content cannot be empty.")
            return redirect(request.META.get("HTTP_REFERER", "/"))

        comment.content = content
        comment.save()

        messages.success(request, "Comment updated successfully!")

        if request.headers.get("X-Requested-With") == "XMLHttpRequest":
            return JsonResponse(
                {
                    "success": True,
                    "content_html": comment.content_html,
                }
            )

    return redirect(request.META.get("HTTP_REFERER", "/"))


@login_required
def delete_comment(request, comment_id):
    """
    Soft delete a comment (owner or moderator only).
    """
    comment = get_object_or_404(Comment, id=comment_id)

    # Check ownership or moderator status
    can_delete = (
        comment.user == request.user
        or request.user.is_staff
        or hasattr(request.user, "profile")
        and request.user.profile.can_moderate_comments
    )

    if not can_delete:
        messages.error(request, "You do not have permission to delete this comment.")
        return redirect(request.META.get("HTTP_REFERER", "/"))

    comment.is_deleted = True
    comment.save()

    messages.success(request, "Comment deleted.")

    if request.headers.get("X-Requested-With") == "XMLHttpRequest":
        return JsonResponse({"success": True})

    return redirect(request.META.get("HTTP_REFERER", "/"))


def analysis_list(request):
    """
    List all analyses - public view.
    """
    analyses_list = Analysis.objects.select_related("user").all()

    # Filter by status if specified
    status = request.GET.get("status")
    if status:
        analyses_list = analyses_list.filter(status=status)

    paginator = Paginator(analyses_list, 20)
    page = request.GET.get("page", 1)
    analyses = paginator.get_page(page)

    context = {
        "analyses": analyses,
        "current_status": status,
    }
    return render(request, "core/analysis_list.html", context)


def analysis_detail(request, analysis_id):
    """
    View analysis details - public view.
    """
    analysis = get_object_or_404(Analysis, id=analysis_id)

    # Get comments for this analysis
    comments = (
        Comment.objects.filter(
            entity_type="analysis",
            entity_id=str(analysis_id),
            is_deleted=False,
            parent__isnull=True,
        )
        .select_related("user")
        .prefetch_related("replies")
    )

    context = {
        "analysis": analysis,
        "comments": comments,
        "can_comment": request.user.is_authenticated,
    }
    return render(request, "core/analysis_detail.html", context)
