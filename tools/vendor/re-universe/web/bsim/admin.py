from django.contrib import admin
from .models import Exetable, Desctable, Keyvaluetable, Cattable


@admin.register(Exetable)
class ExetableAdmin(admin.ModelAdmin):
    """Read-only admin for BSim executables."""

    list_display = ["name_exec", "md5", "architecture", "ingest_date"]
    list_filter = ["architecture"]
    search_fields = ["name_exec", "md5"]
    readonly_fields = [
        "id",
        "md5",
        "name_exec",
        "architecture",
        "name_compiler",
        "ingest_date",
        "path",
        "repository",
        "id_category",
    ]

    def has_add_permission(self, request):
        return False  # Read-only

    def has_delete_permission(self, request, obj=None):
        return False  # Read-only

    def has_change_permission(self, request, obj=None):
        return False  # Read-only


@admin.register(Keyvaluetable)
class KeyvaluetableAdmin(admin.ModelAdmin):
    """Read-only admin for BSim configuration."""

    list_display = ["key", "value"]
    search_fields = ["key"]
    readonly_fields = ["key", "value", "val"]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False
