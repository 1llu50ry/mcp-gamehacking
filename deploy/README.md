# Deployment recipes

Choose the one that matches your host.

| Target | Entry point |
|--------|-------------|
| Docker / docker-compose | [`../docker-compose.yml`](../docker-compose.yml) + [`../Dockerfile`](../Dockerfile) |
| Linux systemd | [`systemd/install.sh`](systemd/install.sh) |
| Windows service | [`windows/install-service.ps1`](windows/install-service.ps1) |
| Dev-container | [`../.devcontainer/devcontainer.json`](../.devcontainer/devcontainer.json) |

## Linux systemd

```bash
sudo ./deploy/systemd/install.sh                   # defaults: /opt/mcp-reverse + user "mcp"
sudo systemctl status mcp-reverse
journalctl -u mcp-reverse -f
```

The unit file hardens the service: `ProtectSystem=strict`,
`ProtectHome=yes`, a locked `SystemCallFilter`, and
`ReadWritePaths` limited to the server's own cache / audit dirs.

## Windows service (NSSM)

```powershell
# Elevated PowerShell:
.\deploy\windows\install-service.ps1 -Install -Port 7777 -Token (New-Guid).Guid -FsAllow "C:\samples"
Get-Service mcp-reverse
```

Uninstall:

```powershell
.\deploy\windows\install-service.ps1 -Uninstall
```

## Verifying the install

```bash
curl -s http://127.0.0.1:7777/healthz
curl -s http://127.0.0.1:7777/metrics | head -20
# open /dashboard in a browser for the live view
```
