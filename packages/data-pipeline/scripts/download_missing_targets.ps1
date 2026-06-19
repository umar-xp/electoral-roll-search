param(
  [string]$BaseDir = (Get-Location).Path,
  [string]$TargetsCsvPath = ".\\missing_ac_targets.csv",
  [string]$AuditOutPath = ".\\missing_ac_audit.csv",
  [int]$StartPart = 1,
  [int]$ExtraMaxPart = 200,
  [int]$MaxPartDefault = 2500,
  [int]$StopMisses = 300,
  [int]$NoHitStopMisses = 300,
  [bool]$ResumeFromDisk = $true,
  [int]$MinSleepMs = 200,
  [int]$MaxSleepMs = 800
)

$ErrorActionPreference = "Stop"

function Safe-Name([string]$Value) {
  $invalid = [System.IO.Path]::GetInvalidFileNameChars()
  $s = ""
  if ($null -ne $Value) { $s = ([string]$Value) }
  $s = $s.Trim()
  foreach ($c in $invalid) { $s = $s.Replace([string]$c, "_") }
  $s = ($s -replace "\s+", " ").Trim()
  return $s
}

function Get-AcPdfCount([string]$ResolvedBaseDir, [string]$DistrictName, [int]$AcNum) {
  $districtDir = Join-Path $ResolvedBaseDir (Safe-Name $DistrictName)
  if (-not (Test-Path -LiteralPath $districtDir)) { return 0 }

  $pattern = "AC $AcNum -*"
  $acDirs = @(Get-ChildItem -LiteralPath $districtDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like $pattern })
  if (-not $acDirs -or $acDirs.Count -eq 0) { return 0 }

  $prefix = ("A{0:D3}" -f $AcNum)
  $regex = ("^{0}\d{{4}}\.pdf$" -f [regex]::Escape($prefix))
  $count = 0
  foreach ($d in $acDirs) {
    $files = @(Get-ChildItem -LiteralPath $d.FullName -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $regex })
    $count += $files.Count
  }
  return $count
}

function To-IntOrNull($Value) {
  if ($null -eq $Value) { return $null }
  $s = [string]$Value
  if (-not $s) { return $null }
  $s = $s.Trim()
  if (-not $s) { return $null }
  try { return [int]$s } catch { return $null }
}

$BaseDir = (Resolve-Path -LiteralPath $BaseDir).Path
$TargetsCsvPath = (Resolve-Path -LiteralPath $TargetsCsvPath).Path

$targets = @(Import-Csv -LiteralPath $TargetsCsvPath)
if (-not $targets -or $targets.Count -eq 0) { throw "No targets found in CSV: $TargetsCsvPath" }

$rows = @()
foreach ($t in $targets) {
  $district = [string]$t.district
  $acNum = To-IntOrNull $t.ac_num
  if (-not $district -or $null -eq $acNum) { continue }

  $expected = To-IntOrNull $t.expected_pdf_count
  $maxPart = $MaxPartDefault
  if ($null -ne $expected) { $maxPart = [Math]::Max($MaxPartDefault, ($expected + $ExtraMaxPart)) }

  $before = Get-AcPdfCount -ResolvedBaseDir $BaseDir -DistrictName $district -AcNum $acNum
  Write-Host ""
  $expectedLabel = ""
  if ($null -ne $expected) { $expectedLabel = [string]$expected }
  Write-Host ("=== TARGET {0} / AC {1} (before={2}, expected={3}, maxPart={4}) ===" -f $district, $acNum, $before, $expectedLabel, $maxPart)

  $exitCode = 0
  try {
    & ".\\download_rolls.ps1" `
      -BaseDir $BaseDir `
      -District $district `
      -AC $acNum `
      -StartPart $StartPart `
      -MaxPart $maxPart `
      -StopMisses $StopMisses `
      -NoHitStopMisses $NoHitStopMisses `
      -MinSleepMs $MinSleepMs `
      -MaxSleepMs $MaxSleepMs `
      -ResumeFromDisk:$ResumeFromDisk | Out-Null
  } catch {
    $exitCode = 1
    Write-Host ("ERROR running download for {0} AC {1}: {2}" -f $district, $acNum, $_.Exception.Message)
  }

  $after = Get-AcPdfCount -ResolvedBaseDir $BaseDir -DistrictName $district -AcNum $acNum
  $delta = $after - $before

  $status = "OK"
  if ($exitCode -ne 0) { $status = "ERROR" }
  elseif ($after -eq 0) { $status = "NO_PDFS_FOUND" }
  elseif ($delta -eq 0) { $status = "NO_NEW_PDFS" }
  elseif ($delta -gt 0) { $status = "DOWNLOADED" }

  $stillMissing = $null
  if ($null -ne $expected) { $stillMissing = [Math]::Max(0, ($expected - $after)) }

  $rows += [pscustomobject]@{
    district = $district
    ac_num = $acNum
    local_pdf_count_before = $before
    local_pdf_count_after = $after
    downloaded_new = $delta
    expected_pdf_count = $expected
    still_missing_vs_expected = $stillMissing
    status = $status
    notes = [string]$t.notes
  }
}

$rows | Export-Csv -LiteralPath $AuditOutPath -NoTypeInformation -Encoding utf8
Write-Host ""
Write-Host ("WROTE_AUDIT {0}" -f (Resolve-Path -LiteralPath $AuditOutPath).Path)
