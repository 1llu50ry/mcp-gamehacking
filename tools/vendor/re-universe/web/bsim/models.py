"""
BSim Database Models - Read-only mapping to Ghidra BSim tables.
These models map directly to the BSim PostgreSQL schema.
DO NOT run migrations on these - they are managed by Ghidra.
"""

from django.db import models


class Exetable(models.Model):
    """
    Maps to BSim exetable - Executable metadata.
    """

    id = models.BigAutoField(primary_key=True)
    md5 = models.CharField(max_length=32)
    name_exec = models.CharField(max_length=1024)
    architecture = models.CharField(max_length=64, blank=True)
    name_compiler = models.CharField(max_length=128, blank=True)
    ingest_date = models.DateTimeField(null=True, blank=True)
    path = models.CharField(max_length=2048, blank=True)
    repository = models.CharField(max_length=512, blank=True)
    id_category = models.IntegerField(null=True, blank=True)

    class Meta:
        managed = False  # Django will not create/modify this table
        db_table = "exetable"
        ordering = ["-ingest_date"]

    def __str__(self):
        return f"{self.name_exec} ({self.md5[:8]}...)"


class Desctable(models.Model):
    """
    Maps to BSim desctable - Function descriptions.
    """

    id = models.BigAutoField(primary_key=True, db_column="id_func")
    id_exe = models.ForeignKey(
        Exetable, on_delete=models.DO_NOTHING, db_column="id_exe"
    )
    name_func = models.CharField(max_length=512)
    address = models.BigIntegerField()
    flags = models.IntegerField(default=0)

    class Meta:
        managed = False
        db_table = "desctable"

    def __str__(self):
        return f"{self.name_func} @ 0x{self.address:x}"

    @property
    def address_hex(self):
        return f"0x{self.address:08x}"


class Callgraphtable(models.Model):
    """
    Maps to BSim callgraphtable - Function call relationships.
    """

    id = models.BigAutoField(primary_key=True)
    src = models.BigIntegerField()  # Caller function ID
    dest = models.BigIntegerField()  # Callee function ID

    class Meta:
        managed = False
        db_table = "callgraphtable"


class Keyvaluetable(models.Model):
    """
    Maps to BSim keyvaluetable - Configuration and metadata.
    """

    key = models.CharField(primary_key=True, max_length=255)
    value = models.TextField(blank=True)
    val = models.TextField(blank=True)

    class Meta:
        managed = False
        db_table = "keyvaluetable"

    def __str__(self):
        return f"{self.key}: {self.value[:50]}..."


class Cattable(models.Model):
    """
    Maps to BSim cattable - Categories.
    """

    id = models.AutoField(primary_key=True, db_column="id_category")
    category = models.CharField(max_length=255)

    class Meta:
        managed = False
        db_table = "cattable"

    def __str__(self):
        return self.category
