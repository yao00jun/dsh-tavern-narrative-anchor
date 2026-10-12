# ==============================================================================
# DSH-Tavern 叙事锚定与多维记忆压缩插件 安装脚本
# 完美支持：桌面版 (DSH Desktop / Windows一键版EXE) 与 Web版 (命令行/浏览器版)
# 符合官方 DSH-Tavern Plugin API v2 热插拔规范
# ==============================================================================

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ">>> 正在检测 DSH-Tavern 运行环境 (桌面版 / Web版)..." -ForegroundColor Cyan

$pluginSource = $PSScriptRoot

# 1. 搜集候选安装路径（涵盖桌面版一键安装包、标准 DSH Desktop、Web版/命令行版）
$candidateRoots = [System.Collections.Generic.List[string]]::new()

# 环境变量
if ($env:DSH_HOME) { $candidateRoots.Add($env:DSH_HOME) }

# 桌面快捷方式与开始菜单快捷方式（针对桌面版一键安装器自定义目录的自动解析）
$shortcutLocations = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "DSH Tavern.lnk"),
    (Join-Path ([Environment]::GetFolderPath("CommonDesktop")) "DSH Tavern.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Programs")) "DSH Tavern.lnk"),
    (Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "DSH Tavern.lnk")
)

foreach ($lnk in $shortcutLocations) {
    if (Test-Path $lnk) {
        try {
            $sh = New-Object -ComObject WScript.Shell
            $targetPath = $sh.CreateShortcut($lnk).TargetPath
            if (-not [string]::IsNullOrWhiteSpace($targetPath) -and (Test-Path $targetPath)) {
                $dir = Split-Path $targetPath -Parent
                if (-not $candidateRoots.Contains($dir)) { $candidateRoots.Add($dir) }
            }
        } catch { }
    }
}

# 常见默认与一键安装路径
$commonPaths = @(
    "D:\AI\DSH-Tavern",
    "C:\AI\DSH-Tavern",
    "D:\Apps\DSH-Tavern",
    "C:\Apps\DSH-Tavern",
    "D:\DSH-Tavern",
    "C:\DSH-Tavern",
    "E:\AI\DSH-Tavern",
    "E:\Apps\DSH-Tavern",
    "E:\DSH-Tavern",
    (Join-Path $env:USERPROFILE ".dsh"),
    (Join-Path $env:APPDATA "DeepSeek\DSH")
)

foreach ($cp in $commonPaths) {
    if (-not $candidateRoots.Contains($cp)) { $candidateRoots.Add($cp) }
}

# 2. 匹配有效的目标 plugins 目录
$targetPlugins = [System.Collections.Generic.List[PSCustomObject]]::new()
$visitedDirs = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

foreach ($root in $candidateRoots) {
    if ([string]::IsNullOrWhiteSpace($root) -or (-not (Test-Path $root))) { continue }

    # 形式 A: 桌面版一键安装包 (<root>/data/harness/profile-data/tavern/data/plugins)
    $pA = Join-Path $root "data\harness\profile-data\tavern\data\plugins"
    $checkA = Join-Path $root "data\harness\profile-data\tavern\data"
    if (Test-Path $checkA) {
        if ($visitedDirs.Add($pA)) {
            $targetPlugins.Add([PSCustomObject]@{ Path = $pA; Type = "桌面版 (EXE独立客户端)"; Root = $root })
        }
    }

    # 形式 B: 标准桌面版 / 命令行Web版 (<root>/profile-data/tavern/data/plugins)
    $pB = Join-Path $root "profile-data\tavern\data\plugins"
    $checkB = Join-Path $root "profile-data\tavern\data"
    if (Test-Path $checkB) {
        if ($visitedDirs.Add($pB)) {
            $typeDesc = if ($root -like "*\.dsh*") { "DSH Desktop / 全局Web版" } else { "标准配置版" }
            $targetPlugins.Add([PSCustomObject]@{ Path = $pB; Type = $typeDesc; Root = $root })
        }
    }
}

# 若未自动扫描到，提供手动输入入口
if ($targetPlugins.Count -eq 0) {
    Write-Host "[!] 未能自动定位 DSH-Tavern 目录。" -ForegroundColor Yellow
    $manualInput = Read-Host "请输入您的 DSH-Tavern 安装路径 (例如 D:\AI\DSH-Tavern)"
    if (-not [string]::IsNullOrWhiteSpace($manualInput)) {
        if (Test-Path (Join-Path $manualInput "data\harness\profile-data\tavern\data")) {
            $p = Join-Path $manualInput "data\harness\profile-data\tavern\data\plugins"
            $targetPlugins.Add([PSCustomObject]@{ Path = $p; Type = "手动指定 (桌面版)"; Root = $manualInput })
        } elseif (Test-Path (Join-Path $manualInput "profile-data\tavern\data")) {
            $p = Join-Path $manualInput "profile-data\tavern\data\plugins"
            $targetPlugins.Add([PSCustomObject]@{ Path = $p; Type = "手动指定 (Web版)"; Root = $manualInput })
        }
    }
}

if ($targetPlugins.Count -eq 0) {
    Write-Host "[ERROR] 无法确定 DSH-Tavern 插件安装目标目录，安装中止。" -ForegroundColor Red
    exit 1
}

Write-Host ">>> 检测到以下运行环境：" -ForegroundColor Green
foreach ($t in $targetPlugins) {
    Write-Host ("  - [" + $t.Type + "] " + $t.Path) -ForegroundColor White
}

# 3. 部署插件文件到所有检测到的环境
$filesToCopy = @("package.json", "cordis.patch.yml", "index.mjs", "client.js", "README.md", "LICENSE")

foreach ($t in $targetPlugins) {
    $destPluginDir = Join-Path $t.Path "dsh-tavern-narrative-anchor"
    Write-Host ">>> 正在部署到: $destPluginDir ..." -ForegroundColor Cyan

    if (-not (Test-Path $destPluginDir)) {
        New-Item -ItemType Directory -Path $destPluginDir -Force | Out-Null
    }

    foreach ($f in $filesToCopy) {
        $src = Join-Path $pluginSource $f
        if (Test-Path $src) {
            Copy-Item -Path $src -Destination $destPluginDir -Force
        }
    }

    $srcLib = Join-Path $pluginSource "lib"
    if (Test-Path $srcLib) {
        Copy-Item -Path $srcLib -Destination $destPluginDir -Recurse -Force
    }

    $dataDir = Join-Path $destPluginDir "data"
    New-Item -ItemType Directory -Path (Join-Path $dataDir "anchors") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $dataDir "session-worldbooks") -Force | Out-Null
}

Write-Host '========================================================' -ForegroundColor Green
Write-Host ' 恭喜！叙事锚定与多维记忆压缩插件 安装成功！' -ForegroundColor Green
Write-Host ' 完美适配：DSH-Tavern 桌面版客户端 与 Web版/命令行版' -ForegroundColor Green
Write-Host '========================================================' -ForegroundColor Green
Write-Host ''
Write-Host '【生效方式】' -ForegroundColor White
Write-Host '  1. 桌面版 (DSH Tavern.exe / DSH Desktop)：'
Write-Host '     在桌面端按 Ctrl+R（或退出重新双击打开桌面快捷方式）即可加载。'
Write-Host '  2. Web版 (浏览器打开)：'
Write-Host '     在浏览器中按 F5 刷新页面即可加载。'
Write-Host '  3. 界面入口：'
Write-Host '     在酒馆界面右侧栏点击 [+]，即可看到「叙事锚定」分组与面板！'
Write-Host ''
Write-Host '【在线安装语法】' -ForegroundColor White
Write-Host '  在任何终端或 DSH 终端执行：'
Write-Host '  dsh plugin add github:yao00jun/dsh-tavern-narrative-anchor' -ForegroundColor Yellow
Write-Host '========================================================' -ForegroundColor Green
