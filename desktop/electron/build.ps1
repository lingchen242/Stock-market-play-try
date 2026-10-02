# 把游戏打包成 Windows 可执行文件。
#
# 产物（都在 desktop\dist-electron\ 下）：
#   StockSim-1.0.0-portable.exe   免安装便携版，双击即玩
#   StockSim-1.0.0-setup.exe      NSIS 安装版，可选安装目录、建桌面快捷方式
#
# electron-builder 还会从 GitHub 下载 winCodeSign 与 nsis 打包器，
# 所以这里同样要把下载源指向国内镜像。
#
# 用法：npm run electron:build（在仓库根目录执行）

$ErrorActionPreference = 'Stop'

$env:ELECTRON_MIRROR = 'https://registry.npmmirror.com/-/binary/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://registry.npmmirror.com/-/binary/electron-builder-binaries/'

Write-Host '开始打包（首次运行会额外下载 winCodeSign 与 nsis 打包器）...'
Write-Host ''

npx electron-builder --win --x64 --config desktop/electron-builder.yml

Write-Host ''
Write-Host '打包完成，产物在 desktop\dist-electron\ ：'
Get-ChildItem 'desktop/dist-electron' -Filter '*.exe' -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0}  {1:N1} MB' -f $_.Name, ($_.Length / 1MB) }
