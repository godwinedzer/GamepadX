$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$clientDir = Join-Path $root 'client'
$serverDir = Join-Path $root 'server'
$failures = 0
$warnings = 0

function Add-Pass($message) {
    Write-Host "[PASS] $message"
}

function Add-Fail($message) {
    Write-Host "[FAIL] $message"
    $script:failures++
}

function Add-Warn($message) {
    Write-Host "[WARN] $message"
    $script:warnings++
}

function Invoke-ExternalTool {
    param(
        [string]$ExePath,
        [string[]]$Arguments
    )

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ExePath
    $psi.Arguments = (($Arguments | ForEach-Object {
        if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
    }) -join ' ')
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    $combined = @()
    if ($stdout) { $combined += ($stdout -split "`r?`n") }
    if ($stderr) { $combined += ($stderr -split "`r?`n") }

    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Lines = @($combined | Where-Object { $_ -ne '' })
    }
}

function Test-Tool {
    param(
        [string]$Label,
        [string]$Exe,
        [string[]]$Arguments,
        [switch]$Optional
    )

    $command = Get-Command $Exe -ErrorAction SilentlyContinue
    if (-not $command) {
        if ($Optional) {
            Add-Warn "$Label not found in PATH. Optional but helpful."
        } else {
            Add-Fail "$Label not found in PATH."
        }
        return
    }

    $result = Invoke-ExternalTool -ExePath $command.Source -Arguments $Arguments
    $firstLine = ($result.Lines | Select-Object -First 1)

    if ($result.ExitCode -ne 0) {
        if ($Optional) {
            Add-Warn "$Label found but did not run cleanly. $firstLine"
        } else {
            Add-Fail "$Label command exists but did not run cleanly. $firstLine"
        }
        return
    }

    if ([string]::IsNullOrWhiteSpace("$firstLine")) {
        Add-Pass "$Label found."
    } else {
        Add-Pass "${Label}: $firstLine"
    }
}

Write-Host '=========================================='
Write-Host '  ZapGamepad Prerequisite Check'
Write-Host '=========================================='
Write-Host ''

if ($env:OS -eq 'Windows_NT') {
    Add-Pass 'Windows host detected.'
} else {
    Add-Fail 'This project server requires Windows.'
}

if (Test-Path $clientDir) {
    Add-Pass "Client folder found at `"$clientDir`"."
} else {
    Add-Fail "Client folder missing at `"$clientDir`"."
}

if (Test-Path $serverDir) {
    Add-Pass "Server folder found at `"$serverDir`"."
} else {
    Add-Fail "Server folder missing at `"$serverDir`"."
}

Test-Tool -Label 'Git' -Exe 'git' -Arguments @('--version')
Test-Tool -Label 'Node.js' -Exe 'node' -Arguments @('--version')
Test-Tool -Label 'npm' -Exe 'npm.cmd' -Arguments @('--version')
Test-Tool -Label 'Rust cargo' -Exe 'cargo' -Arguments @('--version')
Test-Tool -Label 'Rustup' -Exe 'rustup' -Arguments @('--version')
Test-Tool -Label 'Java' -Exe 'java' -Arguments @('-version')
Test-Tool -Label 'ADB' -Exe 'adb' -Arguments @('version')

if ($env:ANDROID_HOME) {
    Add-Pass "ANDROID_HOME is set to `"$env:ANDROID_HOME`"."
} elseif ($env:ANDROID_SDK_ROOT) {
    Add-Pass "ANDROID_SDK_ROOT is set to `"$env:ANDROID_SDK_ROOT`"."
} else {
    Add-Fail 'Android SDK environment variable missing. Set ANDROID_HOME or ANDROID_SDK_ROOT.'
}

$androidStudioPaths = @(
    'C:\Program Files\Android\Android Studio\bin\studio64.exe',
    'C:\Program Files (x86)\Android\Android Studio\bin\studio64.exe'
)
$androidStudio = $androidStudioPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($androidStudio) {
    Add-Pass "Android Studio found at `"$androidStudio`"."
} else {
    Add-Warn 'Android Studio not found in standard install paths.'
}

try {
    $pnputilOutput = pnputil /enum-drivers 2>&1
    if ($pnputilOutput -match 'ViGEmBus') {
        Add-Pass 'ViGEmBus driver appears to be installed.'
    } else {
        $null = sc.exe query ViGEmBus 2>&1
        if ($LASTEXITCODE -eq 0) {
            Add-Pass 'ViGEmBus service appears to be installed.'
        } else {
            Add-Fail 'ViGEmBus driver not detected. Install it before running the server.'
        }
    }
} catch {
    Add-Fail 'Could not verify ViGEmBus installation.'
}

Test-Tool -Label 'Python' -Exe 'py' -Arguments @('--version') -Optional
Test-Tool -Label 'scrcpy' -Exe 'scrcpy' -Arguments @('--version') -Optional

Write-Host ''
Write-Host '=========================================='
if ($failures -gt 0) {
    Write-Host 'Result: NOT READY'
    Write-Host "Missing required checks: $failures"
} else {
    Write-Host 'Result: READY'
    Write-Host 'All required checks passed.'
}
if ($warnings -gt 0) {
    Write-Host "Optional warnings: $warnings"
}
Write-Host '=========================================='
Write-Host ''

if ($failures -gt 0) { exit 1 }
exit 0
