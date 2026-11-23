# Half-resolution JPG variants for phones (均衡/流畅 presets). Geometry stays in assets/chars/ and assets/guns/.
# powershell -ExecutionPolicy Bypass -File tools/make-mobile-assets.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$encoder = Join-Path $PSScriptRoot 'encode-jpg.ps1'

function Encode-CharTextures {
  $outDir = Join-Path $root 'assets/chars/m'
  New-Item -ItemType Directory -Force $outDir | Out-Null
  $src = Join-Path $root 'assets/chars'
  foreach ($f in Get-ChildItem -LiteralPath $src -Filter '*.jpg' -File) {
    $size = if ($f.Name -match '_rr\.jpg$') { 256 } else { 512 }
    & $encoder -In $f.FullName -Out $outDir -Size $size -Quality 82
  }
}

function Encode-GunTextures {
  $outDir = Join-Path $root 'assets/guns/m'
  New-Item -ItemType Directory -Force $outDir | Out-Null
  $src = Join-Path $root 'assets/guns'
  $done = @{}
  foreach ($json in Get-ChildItem -LiteralPath $src -Filter '*.json' -File) {
    $model = Get-Content -LiteralPath $json.FullName -Raw | ConvertFrom-Json
  if (-not $model.textures) { continue }
    foreach ($map in $model.textures.psobject.Properties) {
      $file = $map.Value
      if ($done[$file]) { continue }
      $done[$file] = $true
      $srcFile = Join-Path $src $file
      if (-not (Test-Path -LiteralPath $srcFile)) {
        Write-Warning "Missing texture source for $file"
        continue
      }
      $size = if ($map.Name -in 'map', 'normalMap') { 512 } else { 256 }
      & $encoder -In $srcFile -Out $outDir -Size $size -Quality 82
    }
  }
}

Write-Host 'Encoding character textures -> assets/chars/m/'
Encode-CharTextures
Write-Host 'Encoding gun textures -> assets/guns/m/'
Encode-GunTextures
Write-Host 'Done.'