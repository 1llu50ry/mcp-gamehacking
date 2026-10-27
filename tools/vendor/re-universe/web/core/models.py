from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
import markdown


class Comment(models.Model):
    """
    Comment model for discussion threads.
    Can be attached to any entity: function, executable, analysis, etc.
    """

    ENTITY_TYPES = [
        ("function", "Function"),
        ("executable", "Executable"),
        ("analysis", "Analysis"),
        ("general", "General Discussion"),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="comments")
    content = models.TextField()
    content_html = models.TextField(blank=True, editable=False)  # Rendered markdown

    # Entity reference (what this comment is about)
    entity_type = models.CharField(
        max_length=20, choices=ENTITY_TYPES, default="general"
    )
    entity_id = models.CharField(
        max_length=255, blank=True
    )  # e.g., function address, exe MD5
    entity_name = models.CharField(max_length=255, blank=True)  # Human-readable name

    # Threading support
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="replies"
    )

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Soft delete
    is_deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["entity_type", "entity_id"]),
            models.Index(fields=["user", "created_at"]),
        ]

    def __str__(self):
        return f"{self.user.username}: {self.content[:50]}..."

    def save(self, *args, **kwargs):
        # Render markdown to HTML
        self.content_html = markdown.markdown(
            self.content, extensions=["fenced_code", "tables", "nl2br"]
        )
        super().save(*args, **kwargs)

    @property
    def reply_count(self):
        return self.replies.filter(is_deleted=False).count()


class Analysis(models.Model):
    """
    Track analysis jobs submitted by users.
    """

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("failed", "Failed"),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="analyses")
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)

    # Binary information
    binary_name = models.CharField(max_length=255)
    binary_md5 = models.CharField(max_length=32, blank=True)
    binary_path = models.CharField(max_length=1024, blank=True)

    # Status tracking
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    progress = models.IntegerField(default=0)  # 0-100
    error_message = models.TextField(blank=True)

    # Results
    function_count = models.IntegerField(default=0)
    bsim_indexed = models.BooleanField(default=False)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "Analyses"

    def __str__(self):
        return f"{self.name} ({self.status})"


class UserProfile(models.Model):
    """
    Extended user profile for additional settings.
    """

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")

    # Display preferences
    theme = models.CharField(max_length=20, default="dark")
    default_view = models.CharField(max_length=50, default="dashboard")

    # Permissions (beyond Django's built-in)
    can_run_analysis = models.BooleanField(default=True)
    can_moderate_comments = models.BooleanField(default=False)

    # Activity tracking
    last_active = models.DateTimeField(auto_now=True)
    analysis_count = models.IntegerField(default=0)

    def __str__(self):
        return f"Profile: {self.user.username}"
