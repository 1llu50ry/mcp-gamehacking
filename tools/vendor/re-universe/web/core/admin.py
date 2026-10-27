from django.contrib import admin
from .models import Comment, Analysis, UserProfile


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ["user", "entity_type", "entity_name", "created_at", "is_deleted"]
    list_filter = ["entity_type", "is_deleted", "created_at"]
    search_fields = ["content", "user__username", "entity_name"]
    raw_id_fields = ["user", "parent"]
    date_hierarchy = "created_at"


@admin.register(Analysis)
class AnalysisAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "user",
        "status",
        "binary_name",
        "function_count",
        "created_at",
    ]
    list_filter = ["status", "bsim_indexed", "created_at"]
    search_fields = ["name", "binary_name", "binary_md5", "user__username"]
    raw_id_fields = ["user"]
    date_hierarchy = "created_at"


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "can_run_analysis", "can_moderate_comments", "last_active"]
    list_filter = ["can_run_analysis", "can_moderate_comments"]
    search_fields = ["user__username", "user__email"]
