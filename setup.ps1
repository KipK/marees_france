Write-Host "Setting up the environment..."
Write-Host "Installing Node.js dependencies..."

npm install
if ($LASTEXITCODE -ne 0) {
    Write-Error "npm install failed."
    exit $LASTEXITCODE
}

Set-Location -Path "frontend"
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Error "npm install in frontend failed."
    exit $LASTEXITCODE
}
Set-Location -Path ".."

Write-Host "Installing Python dependencies..."

pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Error "pip install requirements.txt failed."
    exit $LASTEXITCODE
}

pip install -r "tools\sphinx-docs\requirements.txt"
if ($LASTEXITCODE -ne 0) {
    Write-Error "pip install sphinx-docs requirements failed."
    exit $LASTEXITCODE
}

Write-Host "✅ All done."
