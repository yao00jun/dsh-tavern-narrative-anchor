# ==============================================================================
# DSH-Tavern 叙事锚定与多维记忆压缩插件 安装脚本
# 符合官方 DSH-Tavern Plugin API v2 热插拔规范
# ==============================================================================

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ">>> 正在检测 DSH-Tavern 环境..." -ForegroundColor Cyan

$pluginSource = $PSScriptRoot

# 1. 寻找 DSH-Tavern 数据根目录
$userProfileDsh = Join-Path $env:USERPROFILE ".dsh"
$candidateRoots = @(
    $env:DSH_HOME,
    "D:\AI\DSH-Tavern\data\harness",
    "D:\AI\DSH-Tavern",
    "C:\AI\DSH-Tavern\data\harness",
    "C:\AI\DSH-Tavern",
    $userProfileDsh
)

$targetPluginsDir = $null

foreach ($root in $candidateRoots) {
    if ([string]::IsNullOrWhiteSpace($root)) { continue }
    
    # 路径形式 A: <root>/profile-data/tavern/data/plugins
    $pA = Join-Path $root "profile-data\tavern\data\plugins"
    if (Test-Path (Join-Path $root "profile-data\tavern\data")) {
        $targetPluginsDir = $pA
        break
    }

    # 路径形式 B: <root>/data/harness/profile-data/tavern/data/plugins
    $pB = Join-Path $root "data\harness\profile-data\tavern\data\plugins"
    if (Test-Path (Join-Path $root "data\harness\profile-data\tavern\data")) {
        $targetPluginsDir = $pB
        break
    }
}

if (-not $targetPluginsDir) {
    Write-Host "[!] 未能自动识别 DSH-Tavern 安装路径。" -ForegroundColor Yellow
    $manualInput = Read-Host "请输入您的 DSH-Tavern 目录 (例如 D:\AI\DSH-Tavern)"
    if (-not [string]::IsNullOrWhiteSpace($manualInput)) {
        if (Test-Path (Join-Path $manualInput "data\harness\profile-data\tavern\data")) {
            $targetPluginsDir = Join-Path $manualInput "data\harness\profile-data\tavern\data\plugins"
        } elseif (Test-Path (Join-Path $manualInput "profile-data\tavern\data")) {
            $targetPluginsDir = Join-Path $manualInput "profile-data\tavern\data\plugins"
        }
    }
}

if (-not $targetPluginsDir) {
    Write-Host "[ERROR] 无法确定 DSH-Tavern 插件安装目标目录，安装中止。" -ForegroundColor Red
    exit 1
}

$destPluginDir = Join-Path $targetPluginsDir "dsh-tavern-narrative-anchor"

Write-Host ">>> 目标插件目录: $destPluginDir" -ForegroundColor Green

# 2. 创建插件目录
if (-not (Test-Path $destPluginDir)) {
    New-Item -ItemType Directory -Path $destPluginDir -Force | Out-Null
}

# 3. 部署插件文件
Write-Host ">>> 正在复制插件文件..." -ForegroundColor Cyan

$filesToCopy = @("package.json", "cordis.patch.yml", "index.mjs", "client.js", "README.md", "LICENSE")
foreach ($f in $filesToCopy) {
    $src = Join-Path $pluginSource $f
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $destPluginDir -Force
    }
}

# 复制 lib 目录
$srcLib = Join-Path $pluginSource "lib"
if (Test-Path $srcLib) {
    Copy-Item -Path $srcLib -Destination $destPluginDir -Recurse -Force
}

# 创建数据存储目录
$dataDir = Join-Path $destPluginDir "data"
New-Item -ItemType Directory -Path (Join-Path $dataDir "anchors") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dataDir "session-worldbooks") -Force | Out-Null

Write-Host '========================================================' -ForegroundColor Green
Write-Host ' 恭喜！叙事锚定与多维记忆压缩插件 安装成功！' -ForegroundColor Green
Write-Host '========================================================' -ForegroundColor Green
Write-Host ''
Write-Host '【生效方式】' -ForegroundColor White
Write-Host '  1. 插件完全基于官方 Plugin API v2 热插拔设计，无需修改酒馆源码！'
Write-Host '  2. 如果 DSH 酒馆正在运行，只需在浏览器中刷新一次酒馆页面即可。'
Write-Host '  3. 打开酒馆右侧栏点击 [+]，即可看到「叙事锚定」分组与对应的三个面板！'
Write-Host ''
Write-Host '【在线安装语法】' -ForegroundColor White
Write-Host '  上传到 GitHub 后，任何人只需在 DSH 终端执行：'
Write-Host '  dsh plugin add github:<你的用户名>/dsh-tavern-narrative-anchor' -ForegroundColor Yellow
Write-Host '========================================================' -ForegroundColor Green
