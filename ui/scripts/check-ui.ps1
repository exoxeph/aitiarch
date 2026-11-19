param(
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [string]$CheckDirectory=''
)
# Run after npm run build. Logs and screenshots must stay outside the repository.
$ErrorActionPreference='Stop'
$ui=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(!$CheckDirectory){$CheckDirectory=Join-Path $ui 'check'}
$repo=[IO.Path]::GetFullPath((Join-Path $ui '..'))
$output=[IO.Path]::GetFullPath($OutputDirectory)
if($output.Equals($repo,[StringComparison]::OrdinalIgnoreCase) -or $output.StartsWith($repo+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'OutputDirectory must be outside the repository.'}
$node=(Get-Command node -ErrorAction Stop).Source
$skip=@('config-isolation.mjs','manual-fixture.mjs','external-edit.mjs')
$checks=@(Get-ChildItem -LiteralPath $CheckDirectory -Filter '*.mjs' | Where-Object {$_.Name -notin $skip} | Sort-Object Name)
if(!$checks.Count){throw 'No browser checks found.'}
New-Item -ItemType Directory -Path $output -Force | Out-Null
Set-Location -LiteralPath $ui
$results=@();$failed=0
# Native stderr is captured as evidence, not interpreted as a PowerShell terminating error.
$ErrorActionPreference='Continue'
foreach($check in $checks){
 $name=$check.BaseName
 $shots=Join-Path $output $name
 New-Item -ItemType Directory -Path $shots -Force | Out-Null
 $env:BATCH2A_OUTPUT=$shots;$env:GROVE_OUTPUT=$shots;$env:PHASE2_SHOTS=$shots;$env:PHASE3_SHOTS=$shots;$env:PHASE4_SHOTS=$shots
 # Also isolate checks which spawn their own server instead of importing config-isolation.mjs.
 $env:AITIARCH_CONFIG_DIR=Join-Path $shots ('config-'+[guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory -Path $env:AITIARCH_CONFIG_DIR -Force | Out-Null
 $timer=[Diagnostics.Stopwatch]::StartNew()
 # Start-Process + WaitForExit returned null ExitCode on this host. Capture the native exit immediately instead.
 & $node $check.FullName 1> (Join-Path $output "$name.out.log") 2> (Join-Path $output "$name.err.log")
 $code=$LASTEXITCODE
 if($null -eq $code){$code=1}
 $timer.Stop()
 if($code -ne 0){$failed++}
 $results+=[pscustomobject]@{check=$check.Name;exitCode=[int]$code;seconds=[math]::Round($timer.Elapsed.TotalSeconds,2)}
 ConvertTo-Json -InputObject @($results) | Set-Content -LiteralPath (Join-Path $output 'results.json')
 Write-Output "$($check.Name): exit=$code seconds=$([math]::Round($timer.Elapsed.TotalSeconds,2))"
}
Write-Output "TOTAL=$($results.Count) FAILED=$failed"
exit ([int]($failed -gt 0))
