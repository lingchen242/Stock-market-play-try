# 一次性安装 Electron 打包工具链。
#
# 这一步会联网下载约 250 MB，且默认下载源在 GitHub —— 本机 github.com 不通，
# 所以脚本里强制把下载源指向国内镜像。不设置镜像的话，安装会在下载预编译二进制时失败。
#
# 用法：npm run electron:setup     （或直接 powershell -ExecutionPolicy Bypass -File electron/setup.ps1）

$ErrorActionPreference = 'Stop'

$env:ELECTRON_MIRROR = 'https://registry.npmmirror.com/-/binary/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://registry.npmmirror.com/-/binary/electron-builder-binaries/'

Write-Host '下载源已切到国内镜像：'
Write-Host "  ELECTRON_MIRROR                  = $env:ELECTRON_MIRROR"
Write-Host "  ELECTRON_BUILDER_BINARIES_MIRROR = $env:ELECTRON_BUILDER_BINARIES_MIRROR"
Write-Host ''
Write-Host '开始安装 electron 与 electron-builder ...'
Write-Host '（electron 包本身只有 1 MB 左右，但安装脚本会另外拉 100+ MB 的预编译二进制，请耐心等待）'
Write-Host ''

npm install --save-dev electron electron-builder

Write-Host ''
Write-Host '安装完成。下一步：'
Write-Host '  npm run electron:dev      先用开发模式试跑一下'
Write-Host '  npm run electron:build    确认没问题后再打包成 exe'
