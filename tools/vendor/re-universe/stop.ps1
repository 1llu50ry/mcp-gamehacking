# RE Analysis Platform - Stop Script

Write-Host "Stopping Ghidra Server..." -ForegroundColor Cyan
docker-compose down

Write-Host "Cleaning up volumes (optional)..." -ForegroundColor Yellow
$response = Read-Host "Do you want to remove volumes? This will delete all analysis data. (y/N)"
if ($response -eq "y" -or $response -eq "Y") {
    docker-compose down -v
    Write-Host "Volumes removed" -ForegroundColor Red
} else {
    Write-Host "Volumes preserved" -ForegroundColor Green
}
