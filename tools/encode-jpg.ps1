# Resize images (PNG/BMP/JPG) to at most -Size pixels per side and save them as JPG.
# powershell -ExecutionPolicy Bypass -File tools/encode-jpg.ps1 -In <file|dir> -Out <dir> [-Size 1024] [-Quality 88] [-Filter *.png]
param([string]$In, [string]$Out, [int]$Size = 1024, [int]$Quality = 88, [string]$Filter = '*')
Add-Type -AssemblyName System.Drawing
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ps = New-Object System.Drawing.Imaging.EncoderParameters 1
$ps.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$Quality)
New-Item -ItemType Directory -Force $Out | Out-Null
$files = if (Test-Path $In -PathType Leaf) { @(Get-Item $In) } else { Get-ChildItem $In -File -Filter $Filter }
foreach ($f in $files) {
  $img = [System.Drawing.Image]::FromFile($f.FullName)
  $s = [Math]::Min(1.0, $Size / [Math]::Max($img.Width, $img.Height))
  $w = [int]([Math]::Round($img.Width * $s)); $h = [int]([Math]::Round($img.Height * $s))
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, $w, $h); $g.Dispose()
  $dst = Join-Path $Out ($f.BaseName + '.jpg'); $bmp.Save($dst, $enc, $ps); $bmp.Dispose(); $img.Dispose()
  '{0} -> {1}x{2} {3:N0} KB' -f $f.Name, $w, $h, ((Get-Item $dst).Length / 1KB)
}
