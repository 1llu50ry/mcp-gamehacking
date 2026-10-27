from django.urls import path
from . import views

app_name = "core"

urlpatterns = [
    path("", views.index, name="index"),
    path("discussion/", views.discussion, name="discussion"),
    path("comment/post/", views.post_comment, name="post_comment"),
    path("comment/<int:comment_id>/edit/", views.edit_comment, name="edit_comment"),
    path(
        "comment/<int:comment_id>/delete/", views.delete_comment, name="delete_comment"
    ),
    path("analysis/", views.analysis_list, name="analysis_list"),
    path("analysis/<int:analysis_id>/", views.analysis_detail, name="analysis_detail"),
]
