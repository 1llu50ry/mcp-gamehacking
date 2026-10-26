# tools/

Vibe-RE ships a bundled Windows radare2 build under `tools/radare2-6.1.0-w64/`. We removed the binaries from this repo (they were LFS-tracked and would bloat the clone). To restore them:

## Option 1 — upstream download

```powershell
cd tools/vendor/vibe-re/tools
Invoke-WebRequest -Uri "https://github.com/radareorg/radare2/releases/download/6.1.0/radare2-6.1.0-w64.zip" -OutFile r2.zip
Expand-Archive r2.zip -DestinationPath .
Remove-Item r2.zip
```

## Option 2 — system install

```powershell
# Chocolatey
choco install radare2

# OR winget
winget install radareorg.radare2
```

The vibe-re Python modules under `../retools/` discover `radare2` by looking at `tools/radare2-6.1.0-w64/bin/radare2.exe` first, then falling back to `$PATH`.
