param(
  [string]$BaseDir = (Get-Location).Path,
  [string]$District,
  [int]$AC,
  [int]$StartPart = 1,
  [int]$MaxPart = 2000,
  [int]$StopMisses = 30,
  [int]$NoHitStopMisses = 80,
  [switch]$Resume,
  [string]$StatePath,
  [bool]$ResumeFromDisk = $true,
  [int]$MinSleepMs = 200,
  [int]$MaxSleepMs = 800,
  [int]$TimeoutSec = 120,
  [int]$Retries = 3
)

$ErrorActionPreference = "Stop"

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
}

$AcListRaw = @"
District 
 Constituency Name 
 Assembly Constituency Number 
 BAGALKOT 
 Jamkhandi 
 A210 
 BAGALKOT 
 Bilgi 
 A211 
 BAGALKOT 
 Mudhol 
 A212 
 BAGALKOT 
 Bagalkot 
 A213 
 BAGALKOT 
 Badami 
 A214 
 BAGALKOT 
 Gulegud 
 A215 
 BAGALKOT 
 Hungund 
 A216 
 BANGALORE RURAL 
 Kanakapura 
 A091 
 BANGALORE RURAL 
 Sathanur 
 A092 
 BANGALORE RURAL 
 Channapatna 
 A093 
 BANGALORE RURAL 
 Ramanagar 
 A094 
 BANGALORE RURAL 
 Magadi 
 A095 
 BANGALORE RURAL 
 Nelamangala 
 A096 
 BANGALORE RURAL 
 Doddaballapur 
 A097 
 BANGALORE RURAL 
 Devanahalli 
 A098 
 BANGALORE RURAL 
 Hosakote 
 A099 
 BANGALORE URBAN 
 Yelahanka 
 A088 
 BANGALORE URBAN 
 Uttarahalli 
 A089 
 BANGALORE URBAN 
 Varthur 
 A090 
 BANGALORE URBAN 
 Anekal 
 A100 
 BBMP 
 Malleshwaram 
 A076 
 BBMP 
 Rajaji Nagar 
 A077 
 BBMP 
 Gandhi Nagar 
 A078 
 BBMP 
 Chickpet 
 A079 
 BBMP 
 Binnypet 
 A080 
 BBMP 
 Chamrajpet 
 A081 
 BBMP 
 Basavanagudi 
 A082 
 BBMP 
 Jayanagar 
 A083 
 BBMP 
 Shanti Nagar 
 A084 
 BBMP 
 Shivajinagar 
 A085 
 BBMP 
 Bharathinagar 
 A086 
 BBMP 
 Jayamahal 
 A087 
 BELGAUM 
 Ramdurg 
 A192 
 BELGAUM 
 Saundatti 
 A193 
 BELGAUM 
 Bailhongal 
 A194 
 BELGAUM 
 Kittur 
 A195 
 BELGAUM 
 Khanapur 
 A196 
 BELGAUM 
 Belgaum 
 A197 
 BELGAUM 
 Uchagaon 
 A198 
 BELGAUM 
 Bagewadi 
 A199 
 BELGAUM 
 Gokak 
 A200 
 BELGAUM 
 Arabhavi 
 A201 
 BELGAUM 
 Hukkeri 
 A202 
 BELGAUM 
 Sankeshwar 
 A203 
 BELGAUM 
 Nippani 
 A204 
 BELGAUM 
 Sadalga 
 A205 
 BELGAUM 
 Chikkodi 
 A206 
 BELGAUM 
 Raibag 
 A207 
 BELGAUM 
 Kagwad 
 A208 
 BELGAUM 
 Athani 
 A209 
 BELLARY 
 Siruguppa 
 A031 
 BELLARY 
 Kurugodu 
 A032 
 BELLARY 
 Bellary 
 A033 
 BELLARY 
 Hospet 
 A034 
 BELLARY 
 Sandur 
 A035 
 BELLARY 
 Kudligi 
 A036 
 BELLARY 
 Kottur 
 A037 
 BELLARY 
 Hadagali 
 A038 
 BIDAR 
 Aurad 
 A001 
 BIDAR 
 Bhalki 
 A002 
 BIDAR 
 Hulsoor 
 A003 
 BIDAR 
 Bidar 
 A004 
 BIDAR 
 Humnabad 
 A005 
 BIDAR 
 Basavakalyan 
 A006 
 BIJAPURA 
 Muddebihal 
 A217 
 BIJAPURA 
 Huvina Hipparagi 
 A218 
 BIJAPURA 
 Basavana Bagevadi 
 A219 
 BIJAPURA 
 Tikota 
 A220 
 BIJAPURA 
 Bijapur 
 A221 
 BIJAPURA 
 Ballolli 
 A222 
 BIJAPURA 
 Indi 
 A223 
 BIJAPURA 
 Sindagi 
 A224 
 CHAMARAJANAGAR 
 Hanur 
 A110 
 CHAMARAJANAGAR 
 Kollegal 
 A111 
 CHAMARAJANAGAR 
 Santhemarahalli 
 A119 
 CHAMARAJANAGAR 
 Chamarajanagar 
 A120 
 CHAMARAJANAGAR 
 Gundlupet 
 A121 
 CHIKKAMAGALURU 
 Sringeri 
 A152 
 CHIKKAMAGALURU 
 Mudigere 
 A153 
 CHIKKAMAGALURU 
 Chikmagalur 
 A154 
 CHIKKAMAGALURU 
 Birur 
 A155 
 CHIKKAMAGALURU 
 Kadur 
 A156 
 CHIKKAMAGALURU 
 Tarikere 
 A157 
 CHITRADURGA 
 Bharamasagara 
 A043 
 CHITRADURGA 
 Chitradurga 
 A044 
 CHITRADURGA 
 Molakalmuru 
 A046 
 CHITRADURGA 
 Challakere 
 A047 
 CHITRADURGA 
 Hiriyur 
 A048 
 CHITRADURGA 
 Holalkere 
 A049 
 CHITRADURGA 
 Hosadurga 
 A050 
 DAKSHINA KANNADA 
 Sullia 
 A137 
 DAKSHINA KANNADA 
 Puttur 
 A138 
 DAKSHINA KANNADA 
 Vittla 
 A139 
 DAKSHINA KANNADA 
 Belthangady 
 A140 
 DAKSHINA KANNADA 
 Bantval 
 A141 
 DAKSHINA KANNADA 
 Mangalore 
 A142 
 DAKSHINA KANNADA 
 Ullal 
 A143 
 DAKSHINA KANNADA 
 Surathkal 
 A144 
 DAKSHINA KANNADA 
 Moodabidri 
 A151 
 DAVANGERE 
 Harapanahalli 
 A039 
 DAVANGERE 
 Harihar 
 A040 
 DAVANGERE 
 Davanagere 
 A041 
 DAVANGERE 
 Mayakonda 
 A042 
 DAVANGERE 
 Jagalur 
 A045 
 DAVANGERE 
 Channagiri 
 A158 
 DAVANGERE 
 Honnali 
 A161 
 DHARWAD 
 Dharwad Rural 
 A174 
 DHARWAD 
 Dharwad 
 A175 
 DHARWAD 
 Hubli 
 A176 
 DHARWAD 
 Hubli Rural 
 A177 
 DHARWAD 
 Kalghatgi 
 A178 
 DHARWAD 
 Kundgol 
 A179 
 DHARWAD 
 Navalgund 
 A191 
 GADAG 
 Shirahatti 
 A186 
 GADAG 
 Mundargi 
 A187 
 GADAG 
 Gadag 
 A188 
 GADAG 
 Ron 
 A189 
 GADAG 
 Nargund 
 A190 
 GULBARGA 
 Chincholi 
 A007 
 GULBARGA 
 Kamalapur 
 A008 
 GULBARGA 
 Aland 
 A009 
 GULBARGA 
 Gulbarga 
 A010 
 GULBARGA 
 Shahabad 
 A011 
 GULBARGA 
 Afzalpur 
 A012 
 GULBARGA 
 Chittapur 
 A013 
 GULBARGA 
 Sedam 
 A014 
 GULBARGA 
 Jevargi 
 A015 
 GULBARGA 
 Gurmitkal 
 A016 
 GULBARGA 
 Yadgir 
 A017 
 GULBARGA 
 Shahapur 
 A018 
 GULBARGA 
 Shorapur 
 A019 
 HASSAN 
 Belur 
 A129 
 HASSAN 
 Arsikere 
 A130 
 HASSAN 
 Gandasi 
 A131 
 HASSAN 
 Shravanabelagola 
 A132 
 HASSAN 
 Holenarasipur 
 A133 
 HASSAN 
 Arkalgud 
 A134 
 HASSAN 
 Hassan 
 A135 
 HASSAN 
 Sakleshpur 
 A136 
 HAVERI 
 Shiggaon 
 A180 
 HAVERI 
 Hangal 
 A181 
 HAVERI 
 Hirekerur 
 A182 
 HAVERI 
 Ranibennur 
 A183 
 HAVERI 
 Byadgi 
 A184 
 HAVERI 
 Haveri 
 A185 
 KODAGU 
 Virajpet 
 A126 
 KODAGU 
 Madikeri 
 A127 
 KODAGU 
 Somwarpet 
 A128 
 KOLAR 
 Gauribidanur 
 A064 
 KOLAR 
 Chikballapur 
 A065 
 KOLAR 
 Sidlaghatta 
 A066 
 KOLAR 
 Bagepalli 
 A067 
 KOLAR 
 Chintamani 
 A068 
 KOLAR 
 Srinivasapur 
 A069 
 KOLAR 
 Mulbagal 
 A070 
 KOLAR 
 Kolar Gold Field 
 A071 
 KOLAR 
 Bethamangala 
 A072 
 KOLAR 
 Kolar 
 A073 
 KOLAR 
 Vemagal 
 A074 
 KOLAR 
 Malur 
 A075 
 KOPPAL 
 Kushtagi 
 A026 
 KOPPAL 
 Yelburga 
 A027 
 KOPPAL 
 Kanakagiri 
 A028 
 KOPPAL 
 Gangawati 
 A029 
 KOPPAL 
 Koppal 
 A030 
 MANDYA 
 Nagamangala 
 A101 
 MANDYA 
 Maddur 
 A102 
 MANDYA 
 Kiragaval 
 A103 
 MANDYA 
 Malavalli 
 A104 
 MANDYA 
 Mandya 
 A105 
 MANDYA 
 Keragodu 
 A106 
 MANDYA 
 Shrirangapattana 
 A107 
 MANDYA 
 Pandavapura 
 A108 
 MANDYA 
 Krishnarajpete 
 A109 
 MYSORE 
 Bannur 
 A112 
 MYSORE 
 T. Narasipur 
 A113 
 MYSORE 
 Krishnaraja 
 A114 
 MYSORE 
 Chamaraja 
 A115 
 MYSORE 
 Narasimharaja 
 A116 
 MYSORE 
 Chamundeshwari 
 A117 
 MYSORE 
 Nanjangud 
 A118 
 MYSORE 
 Heggadadevankote 
 A122 
 MYSORE 
 Hunsur 
 A123 
 MYSORE 
 Krishnarajanagara 
 A124 
 MYSORE 
 Periyapatna 
 A125 
 RAICHUR 
 Devadurga 
 A020 
 RAICHUR 
 Raichur 
 A021 
 RAICHUR 
 Kalmala 
 A022 
 RAICHUR 
 Manvi 
 A023 
 RAICHUR 
 Lingsugur 
 A024 
 RAICHUR 
 Sindhanur 
 A025 
 SHIVAMOGGA 
 Holehonnur 
 A159 
 SHIVAMOGGA 
 Bhadravati 
 A160 
 SHIVAMOGGA 
 Shimoga 
 A162 
 SHIVAMOGGA 
 Tirthahalli 
 A163 
 SHIVAMOGGA 
 Hosanagar 
 A164 
 SHIVAMOGGA 
 Sagar 
 A165 
 SHIVAMOGGA 
 Sorab 
 A166 
 SHIVAMOGGA 
 Shikaripura 
 A167 
 TUMKUR 
 Pavagada 
 A051 
 TUMKUR 
 Sira 
 A052 
 TUMKUR 
 Kalambella 
 A053 
 TUMKUR 
 Bellavi 
 A054 
 TUMKUR 
 Madhugiri 
 A055 
 TUMKUR 
 Koratagere 
 A056 
 TUMKUR 
 Tumkur 
 A057 
 TUMKUR 
 Kunigal 
 A058 
 TUMKUR 
 Huliyurdurga 
 A059 
 TUMKUR 
 Gubbi 
 A060 
 TUMKUR 
 Turuvekere 
 A061 
 TUMKUR 
 Tiptur 
 A062 
 TUMKUR 
 Chikkanayakanahalli 
 A063 
 UDUPI 
 Kapu 
 A145 
 UDUPI 
 Udupi 
 A146 
 UDUPI 
 Brahmavar 
 A147 
 UDUPI 
 Kundapura 
 A148 
 UDUPI 
 Byndoor 
 A149 
 UDUPI 
 Karkala 
 A150 
 UTTAR KANNADA 
 Sirsi 
 A168 
 UTTAR KANNADA 
 Bhatkal 
 A169 
 UTTAR KANNADA 
 Kumta 
 A170 
 UTTAR KANNADA 
 Ankola 
 A171 
 UTTAR KANNADA 
 Karwar 
 A172 
 UTTAR KANNADA 
 Haliyal 
 A173 
"@

function Clean-Lines([string]$Raw) {
  $Raw -split "(\r\n|\n|\r)" | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

function Parse-AcList([string]$Raw) {
  $lines = Clean-Lines $Raw
  $headerTokens = @("district", "constituency name", "assembly constituency number")
  $filtered = @()
  foreach ($line in $lines) {
    if ($headerTokens -contains $line.ToLowerInvariant()) { continue }
    $filtered += $line
  }

  if (($filtered.Count % 3) -ne 0) {
    throw "Expected rows of 3 fields (district, constituency, AC code). Got $($filtered.Count) tokens."
  }

  $entries = @()
  for ($i = 0; $i -lt $filtered.Count; $i += 3) {
    $district = $filtered[$i]
    $constituency = $filtered[$i + 1]
    $acCode = $filtered[$i + 2]
    if ($acCode -notmatch "^A\d{1,3}$") { throw "Unexpected AC code format: $acCode" }
    $acNum = [int]($acCode.Substring(1))
    if ($acNum -le 0) { throw "Invalid AC number: $acCode" }
    $entries += [pscustomobject]@{
      District     = $district
      Constituency = $constituency
      AcNum        = $acNum
      AcCode       = $acCode
    }
  }
  return $entries
}

function Safe-Name([string]$Value) {
  $invalid = [System.IO.Path]::GetInvalidFileNameChars()
  $s = $Value.Trim()
  foreach ($c in $invalid) { $s = $s.Replace([string]$c, "_") }
  $s = ($s -replace "\s+", " ").Trim()
  return $s
}

function Build-PdfUrl([string]$DistrictName, [int]$AcNum, [int]$PartNum) {
  $districtSeg = [uri]::EscapeDataString($DistrictName)
  $acFolderSeg = [uri]::EscapeDataString("AC $AcNum")
  $fileName = ("A{0:D3}{1:D4}.pdf" -f $AcNum, $PartNum)
  return "https://ceo.karnataka.gov.in/uploads/$districtSeg/$acFolderSeg/$fileName"
}

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Save-State([string]$Path, [string]$DistrictName, [int]$AcNum, [string]$ConstituencyName, [int]$EntryIndex, [int]$NextPart) {
  $stateObj = [pscustomobject]@{
    District       = $DistrictName
    AcNum          = $AcNum
    Constituency   = $ConstituencyName
    EntryIndex     = $EntryIndex
    NextPart       = $NextPart
    TimestampUtc   = ([DateTime]::UtcNow.ToString("o"))
  }

  $tmp = "$Path.part"
  $json = $stateObj | ConvertTo-Json -Depth 5
  [System.IO.File]::WriteAllText($tmp, $json, [System.Text.Encoding]::UTF8)
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Load-State([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
  if (-not $raw) { return $null }
  return ($raw | ConvertFrom-Json -ErrorAction Stop)
}

function Clear-State([string]$Path) {
  if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue }
}

function Get-ResumeStartPartFromDisk([string]$AcDir, [int]$AcNum, [int]$MinimumPart) {
  if (-not (Test-Path -LiteralPath $AcDir)) { return $MinimumPart }
  $prefix = ("A{0:D3}" -f $AcNum)
  $regex = ("^{0}(\d{{4}})\.pdf$" -f [regex]::Escape($prefix))

  $existing = @{}
  Get-ChildItem -LiteralPath $AcDir -File -ErrorAction SilentlyContinue | ForEach-Object {
    $name = $_.Name
    if ($name -match $regex) {
      $p = [int]$Matches[1]
      $existing[$p] = $true
    }
  }

  $p = $MinimumPart
  while ($existing.ContainsKey($p)) { $p++ }
  return $p
}

function Download-File([string]$Url, [string]$DestPath) {
  if ((Test-Path -LiteralPath $DestPath) -and ((Get-Item -LiteralPath $DestPath).Length -gt 0)) {
    return @{ Ok = $true; Status = 200 }
  }

  $tmp = "$DestPath.part"
  $ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

  for ($attempt = 1; $attempt -le $Retries; $attempt++) {
    try {
      Ensure-Dir ([System.IO.Path]::GetDirectoryName($DestPath))
      $handler = New-Object System.Net.Http.HttpClientHandler
      $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
      $client = New-Object System.Net.Http.HttpClient($handler)
      $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSec)

      $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $Url)
      [void]$req.Headers.UserAgent.ParseAdd($ua)

      $resp = $null
      $contentStream = $null
      $fileStream = $null
      try {
        $resp = $client.SendAsync($req, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        $status = [int]$resp.StatusCode
        if ($status -eq 404) { return @{ Ok = $false; Status = 404 } }
        if (-not $resp.IsSuccessStatusCode) { return @{ Ok = $false; Status = $status } }

        $contentStream = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $fileStream = [System.IO.File]::Open($tmp, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $contentStream.CopyTo($fileStream)
      } finally {
        if ($fileStream) { $fileStream.Dispose() }
        if ($contentStream) { $contentStream.Dispose() }
        if ($resp) { $resp.Dispose() }
        if ($req) { $req.Dispose() }
        if ($client) { $client.Dispose() }
        if ($handler) { $handler.Dispose() }
      }

      Move-Item -LiteralPath $tmp -Destination $DestPath -Force
      return @{ Ok = $true; Status = 200 }
    } catch {
      if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }

      $status = $null

      if ($attempt -lt $Retries) {
        $backoff = [Math]::Min(60000, ([Math]::Pow(2, $attempt) * 1000) + (Get-Random -Minimum 0 -Maximum 1000))
        Start-Sleep -Milliseconds $backoff
        continue
      }

      return @{ Ok = $false; Status = $status }
    }
  }

  return @{ Ok = $false; Status = $null }
}

if ($StartPart -lt 1) { throw "--StartPart must be >= 1" }
if ($MaxPart -lt $StartPart) { throw "--MaxPart must be >= --StartPart" }
if ($StopMisses -lt 1) { throw "--StopMisses must be >= 1" }
if ($NoHitStopMisses -lt 1) { throw "--NoHitStopMisses must be >= 1" }
if ($ResumeFromDisk -ne $true -and $ResumeFromDisk -ne $false) { throw "--ResumeFromDisk must be true/false" }
if ($MinSleepMs -lt 0 -or $MaxSleepMs -lt 0 -or $MaxSleepMs -lt $MinSleepMs) { throw "Sleep bounds invalid" }

$entries = Parse-AcList $AcListRaw
if ($District) { $entries = $entries | Where-Object { $_.District.ToLowerInvariant() -eq $District.ToLowerInvariant() } }
if ($AC) { $entries = $entries | Where-Object { $_.AcNum -eq $AC } }
if (-not $entries -or $entries.Count -eq 0) { throw "No matching entries found for the provided filters." }

$BaseDir = (Resolve-Path -LiteralPath $BaseDir).Path
Ensure-Dir $BaseDir

$stateFilePath = $StatePath
if (-not $stateFilePath) { $stateFilePath = (Join-Path $BaseDir ".rolls_download_state.json") }

$resumeState = $null
if ($Resume) { $resumeState = Load-State -Path $stateFilePath }

$resumeReached = -not $Resume
for ($entryIndex = 0; $entryIndex -lt $entries.Count; $entryIndex++) {
  $e = $entries[$entryIndex]
  $districtName = $e.District
  $constituencyName = $e.Constituency
  $acNum = $e.AcNum

  if (-not $resumeReached -and $resumeState) {
    $targetDistrict = [string]$resumeState.District
    $targetAc = [int]$resumeState.AcNum
    if (($districtName -ne $targetDistrict) -or ($acNum -ne $targetAc)) {
      continue
    }
    $resumeReached = $true
  }

  $districtDir = Join-Path $BaseDir (Safe-Name $districtName)
  $acDirName = Safe-Name ("AC {0} - {1}" -f $acNum, $constituencyName)
  $acDir = Join-Path $districtDir $acDirName
  Ensure-Dir $acDir

  Write-Host ""
  Write-Host ("=== {0} / AC {1} ({2}) ===" -f $districtName, $acNum, $constituencyName)

  $misses = 0
  $downloadedAny = $false

  $effectiveStartPart = $StartPart
  if ($resumeState -and $resumeReached -and ($districtName -eq [string]$resumeState.District) -and ($acNum -eq [int]$resumeState.AcNum)) {
    $effectiveStartPart = [Math]::Max($effectiveStartPart, [int]$resumeState.NextPart)
  }
  if ($ResumeFromDisk) {
    $diskStart = Get-ResumeStartPartFromDisk -AcDir $acDir -AcNum $acNum -MinimumPart $effectiveStartPart
    $effectiveStartPart = [Math]::Max($effectiveStartPart, $diskStart)
  }

  for ($part = $effectiveStartPart; $part -le $MaxPart; $part++) {
    $url = Build-PdfUrl -DistrictName $districtName -AcNum $acNum -PartNum $part
    $fileName = ("A{0:D3}{1:D4}.pdf" -f $acNum, $part)
    $destPath = Join-Path $acDir $fileName

    $result = Download-File -Url $url -DestPath $destPath
    if ($result.Ok) {
      $downloadedAny = $true
      $misses = 0
      Write-Host ("OK  {0}" -f $fileName)
    } else {
      $misses++
      if ($result.Status -eq 404) {
        if (-not $downloadedAny -and $misses -ge $NoHitStopMisses) {
          Write-Host ("STOP after {0} consecutive 404s with no hits (last tried part {1})." -f $misses, $part)
          break
        }
        if ($downloadedAny -and $misses -ge $StopMisses) {
          Write-Host ("STOP after {0} consecutive 404s (last tried part {1})." -f $misses, $part)
          break
        }
      } else {
        Write-Host ("ERR {0} (HTTP {1})" -f $fileName, $result.Status)
        if (-not $downloadedAny -and $misses -ge $NoHitStopMisses) {
          Write-Host ("STOP after {0} consecutive errors with no hits (last tried part {1})." -f $misses, $part)
          break
        }
        if ($downloadedAny -and $misses -ge $StopMisses) {
          Write-Host ("STOP after {0} consecutive errors (last tried part {1})." -f $misses, $part)
          break
        }
      }
    }

    Save-State -Path $stateFilePath -DistrictName $districtName -AcNum $acNum -ConstituencyName $constituencyName -EntryIndex $entryIndex -NextPart ($part + 1)
    if ($MaxSleepMs -gt 0) { Start-Sleep -Milliseconds (Get-Random -Minimum $MinSleepMs -Maximum ($MaxSleepMs + 1)) }
  }

  if (-not $downloadedAny) {
    Write-Host "No PDFs downloaded for this AC (either no parts found or blocked)."
  }
}

Clear-State -Path $stateFilePath
