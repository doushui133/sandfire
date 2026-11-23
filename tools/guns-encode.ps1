# Encode each source once using the filenames recorded by gun-convert.js.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot
$outDir = Join-Path $root 'assets/guns'
$sourceDir = Join-Path $root '_src/cc0-guns'
$encoder = Join-Path $PSScriptRoot 'encode-jpg.ps1'

# FBX UVs put the bottle on the left, the fabric at upper right and the liquid at lower right.
function Write-MolotovAtlas($folder, $map, $destination, $size) {
  $half = [int]($size / 2)
  $bitmap = New-Object Drawing.Bitmap $size,$size
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.InterpolationMode = 'HighQualityBicubic'
    switch ($map) {
      'map'          { $files = 'Bottle_Base_Color.png','Fabric_Base_Colo.png','Liquid_Base_Color.png'; $fill = 'Black' }
      'normalMap'    { $files = $null,'Fabric_Normal_DirectX.png',$null; $fill = '#8080ff' }
      'roughnessMap' { $files = 'Bottle_Roughness.png',$null,$null; $fill = '#bbbbbb' }
      'metalnessMap' { $files = 'Bottle_Metallic.png',$null,$null; $fill = 'Black' }
    }
    $graphics.Clear([Drawing.ColorTranslator]::FromHtml($fill))
    for ($i = 0; $i -lt 3; $i++) {
      if (!$files[$i]) { continue }
      $image = [Drawing.Image]::FromFile((Join-Path $folder $files[$i]))
      try {
        $x = if ($i -eq 0) { 0 } else { $half }
        $y = if ($i -eq 2) { $half } else { 0 }
        $height = if ($i -eq 0) { $size } else { $half }
        $graphics.DrawImage($image, $x, $y, $half, $height)
      } finally { $image.Dispose() }
    }
    $bitmap.Save($destination, [Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}

$done = @{}
$temp = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()))
try {
  foreach ($file in Get-ChildItem -LiteralPath $outDir -Filter '*.json') {
    $model = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
    if ($done[$model.source]) { continue }
    $done[$model.source] = $true
    $folder = Split-Path (Join-Path $sourceDir $model.source)
    foreach ($map in $model.textures.psobject.Properties) {
      $size = if ($map.Name -in 'map','normalMap') { 1024 } else { 512 }
      $name = [IO.Path]::ChangeExtension($map.Value, 'png')
      $png = Join-Path $folder $name
      if ($model.id -eq 'molotov') {
        $png = Join-Path $temp.FullName $name
        Write-MolotovAtlas $folder $map.Name $png $size
      }
      & $encoder -In $png -Out $outDir -Size $size -Quality 85
    }
  }
} finally {
  Get-ChildItem -LiteralPath $temp.FullName -File | Remove-Item
  Remove-Item -LiteralPath $temp.FullName
}
