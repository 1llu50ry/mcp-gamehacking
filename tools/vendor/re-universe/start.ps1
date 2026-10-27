# RE Analysis Platform - Start Script

Write-Host "Starting Ghidra Server..." -ForegroundColor Cyan
docker-compose up -d

Write-Host "Waiting for server initialization..." -ForegroundColor Yellow
Start-Sleep -Seconds 60

Write-Host "Running connectivity tests..." -ForegroundColor Cyan
Test-NetConnection -ComputerName Docker -Port 13100

Write-Host "Ghidra Server is ready!" -ForegroundColor Green
Write-Host "Connect to: Docker:13100" -ForegroundColor Yellow
