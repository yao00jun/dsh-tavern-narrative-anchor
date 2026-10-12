@echo off
chcp 65001 >nul
title DSH-Tavern 叙事锚定插件安装器
echo ========================================================
echo   DSH-Tavern 叙事锚定与多维记忆压缩插件 安装程序
echo ========================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
