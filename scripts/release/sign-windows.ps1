# Signs a Windows binary with Azure Trusted Signing when credentials are present, otherwise
# exits 0 so unsigned local/CI builds still succeed. Set these secrets to enable signing:
#   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET (a service principal with the
#   "Trusted Signing Certificate Profile Signer" role), TRUSTED_SIGNING_ENDPOINT
#   (e.g. https://eus.codesigning.azure.net), TRUSTED_SIGNING_ACCOUNT, TRUSTED_SIGNING_PROFILE.
# Smart App Control and SmartScreen both accept Trusted Signing signatures.
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = "Stop"
if (-not $env:TRUSTED_SIGNING_ACCOUNT -or -not $env:AZURE_CLIENT_ID) {
  Write-Host "sign-windows: no Trusted Signing credentials; leaving $Path unsigned"
  exit 0
}
if (-not (Get-Command signtool.exe -ErrorAction SilentlyContinue)) {
  Write-Host "sign-windows: signtool.exe not on PATH (install the Windows SDK); leaving $Path unsigned"
  exit 0
}
$dlib = Join-Path $env:RUNNER_TEMP "trusted-signing\bin\x64\Azure.CodeSigning.Dlib.dll"
if (-not (Test-Path $dlib)) {
  $zip = Join-Path $env:RUNNER_TEMP "trusted-signing.zip"
  Invoke-WebRequest -Uri "https://www.nuget.org/api/v2/package/Microsoft.Trusted.Signing.Client" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath (Join-Path $env:RUNNER_TEMP "trusted-signing") -Force
}
$metadata = Join-Path $env:RUNNER_TEMP "trusted-signing-metadata.json"
@{
  Endpoint = $env:TRUSTED_SIGNING_ENDPOINT
  CodeSigningAccountName = $env:TRUSTED_SIGNING_ACCOUNT
  CertificateProfileName = $env:TRUSTED_SIGNING_PROFILE
} | ConvertTo-Json | Set-Content -Path $metadata
& signtool.exe sign /v /debug /fd SHA256 /tr "http://timestamp.acs.microsoft.com" /td SHA256 /dlib $dlib /dmdf $metadata $Path
if ($LASTEXITCODE -ne 0) { throw "signtool failed for $Path" }
