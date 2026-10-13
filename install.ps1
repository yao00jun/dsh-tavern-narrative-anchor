# ==============================================================================
# Narrative Anchor v2 (叙事锚定) 安装脚本
# 完美支持：DSH-Tavern 桌面版 (EXE独立版) 与 Web版 (命令行版)
# 遵循 Tavern Plugin API v2 热插拔规范，零源码侵入，无需编译与外部依赖
# ==============================================================================

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ">>> 正在检测 DSH-Tavern 运行环境 (桌面版 / Web版)..." -ForegroundColor Cyan

$pluginSource = $PSScriptRoot

# 1. 搜集候选根目录
$candidateRoots = [System.Collections.Generic.List[string]]::new()

if ($env:DSH_HOME) { $candidateRoots.Add($env:DSH_HOME) }

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
$targetEnvironments = [System.Collections.Generic.List[PSCustomObject]]::new()
$visitedDirs = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

foreach ($root in $candidateRoots) {
    if ([string]::IsNullOrWhiteSpace($root) -or (-not (Test-Path $root))) { continue }

    # 形式 A: 桌面版独立客户端 (<root>/data/harness/profile-data/tavern/data/plugins)
    $dshHomeA = Join-Path $root "data\harness"
    $checkA = Join-Path $dshHomeA "profile-data\tavern\data"
    if (Test-Path $checkA) {
        $pA = Join-Path $dshHomeA "profile-data\tavern\data\plugins"
        if ($visitedDirs.Add($pA)) {
            $targetEnvironments.Add([PSCustomObject]@{
                PluginsDir = $pA
                DataRoot   = $checkA
                DshHome    = $dshHomeA
                Type       = "桌面版 (EXE客户端)"
                Root       = $root
            })
        }
    }

    # 形式 B: 标准桌面版 / 命令行Web版 (<root>/profile-data/tavern/data/plugins)
    $checkB = Join-Path $root "profile-data\tavern\data"
    if (Test-Path $checkB) {
        $pB = Join-Path $root "profile-data\tavern\data\plugins"
        if ($visitedDirs.Add($pB)) {
            $typeDesc = if ($root -like "*\.dsh*") { "DSH Desktop / 全局Web版" } else { "标准配置版" }
            $targetEnvironments.Add([PSCustomObject]@{
                PluginsDir = $pB
                DataRoot   = $checkB
                DshHome    = $root
                Type       = $typeDesc
                Root       = $root
            })
        }
    }
}

if ($targetEnvironments.Count -eq 0) {
    Write-Host "[!] 未能自动定位 DSH-Tavern 目录。" -ForegroundColor Yellow
    $manualInput = Read-Host "请输入您的 DSH-Tavern 安装路径 (例如 D:\AI\DSH-Tavern)"
    if (-not [string]::IsNullOrWhiteSpace($manualInput)) {
        $dshHomeManA = Join-Path $manualInput "data\harness"
        if (Test-Path (Join-Path $dshHomeManA "profile-data\tavern\data")) {
            $targetEnvironments.Add([PSCustomObject]@{
                PluginsDir = Join-Path $dshHomeManA "profile-data\tavern\data\plugins"
                DataRoot   = Join-Path $dshHomeManA "profile-data\tavern\data"
                DshHome    = $dshHomeManA
                Type       = "手动指定 (桌面版)"
                Root       = $manualInput
            })
        } elseif (Test-Path (Join-Path $manualInput "profile-data\tavern\data")) {
            $targetEnvironments.Add([PSCustomObject]@{
                PluginsDir = Join-Path $manualInput "profile-data\tavern\data\plugins"
                DataRoot   = Join-Path $manualInput "profile-data\tavern\data"
                DshHome    = $manualInput
                Type       = "手动指定 (Web版)"
                Root       = $manualInput
            })
        }
    }
}

if ($targetEnvironments.Count -eq 0) {
    Write-Host "[ERROR] 无法确定 DSH-Tavern 插件安装目标目录，安装中止。" -ForegroundColor Red
    exit 1
}

Write-Host ">>> 检测到以下运行环境：" -ForegroundColor Green
foreach ($envItem in $targetEnvironments) {
    Write-Host ("  - [" + $envItem.Type + "] " + $envItem.PluginsDir) -ForegroundColor White
}

# 3. 部署插件文件
$filesToCopy = @("package.json", "index.mjs", "client.js", "verify.mjs", "INSTALL.md", "README.md", "LICENSE")

foreach ($envItem in $targetEnvironments) {
    $pluginsDir = $envItem.PluginsDir
    $dest = Join-Path $pluginsDir "narrative-anchor"

    # 清理旧版本避免插件注册重名冲突
    $legacyDest = Join-Path $pluginsDir "dsh-tavern-narrative-anchor"
    if (Test-Path $legacyDest) {
        Write-Host ">>> 清理旧版插件目录: $legacyDest ..." -ForegroundColor Yellow
        Remove-Item -Path $legacyDest -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host ">>> 正在部署到: $dest ..." -ForegroundColor Cyan
    if (-not (Test-Path $dest)) {
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
    }

    foreach ($file in $filesToCopy) {
        $src = Join-Path $pluginSource $file
        if (Test-Path $src) {
            Copy-Item -Path $src -Destination $dest -Force
        }
    }

    # 4. 自动触发 Tavern 原生插件注册 (生成 .tavern-entry.mjs 并更新 cordis.patch.yml)
    $userPluginJs = Join-Path $envItem.DshHome "apps\dsh-tavern\tavern-plugin\lib\domain\user-plugins.js"
    if (Test-Path $userPluginJs) {
        Write-Host ">>> 正在通过 Tavern Plugin Loader 注册插件..." -ForegroundColor Cyan
        try {
            node -e "import(require('url').pathToFileURL(process.argv[1]).href).then(m => m.syncUserPlugins({ dataRoot: process.argv[2], dshHome: process.argv[3] })).catch(() => {});" "$userPluginJs" "$($envItem.DataRoot)" "$($envItem.DshHome)"
        } catch {
            Write-Host ">>> 注意：将在下次启动 Tavern 时自动同步插件登记。" -ForegroundColor Gray
        }
    }

    # 5. 执行自检验证
    Write-Host "`n>>> 正在运行插件自检 (verify.mjs)..." -ForegroundColor Cyan
    try {
        node (Join-Path $dest "verify.mjs") "$($envItem.DshHome)"
    } catch {
        Write-Host ">>> 自检脚本执行提示：可在重启 Tavern 后再次运行 node verify.mjs 校验。" -ForegroundColor Gray
    }
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host " 恭喜！Narrative Anchor v2 (叙事锚定) 安装成功！" -ForegroundColor Green
Write-Host " 完美适配：DSH-Tavern 桌面版客户端 与 Web版/命令行版" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "【生效与使用方式】" -ForegroundColor White
Write-Host "  1. 重启 DSH Tavern："
Write-Host "     桌面版：托盘图标 -> 退出，然后重新双击启动 DSH Tavern.exe"
Write-Host "     Web/CLI版：执行 dsh-tavern restart"
Write-Host "  2. 运行前提："
Write-Host "     请在 Tavern 的「设置」中确认开启【后台结算/动作结算】开关（插件搭车官方结算）。"
Write-Host "  3. 界面入口："
Write-Host "     打开一局对话，在右侧栏点击【+】->【叙事锚定】分组 -> 即可查看「设置/状态/会话世界书」面板！"
Write-Host "========================================================" -ForegroundColor Green
