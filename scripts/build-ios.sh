#!/usr/bin/env bash
# =============================================================================
# L_Agent —— 构建 iOS（iPad / iPhone）
#
# ⚠️ 说明：iOS 必须在 macOS + Xcode 环境下才能编译与签名，无法在 Linux 上
#   直接产出可安装的 IPA。本脚本用于在 Mac 上同步最新前端并触发构建/导出。
#
# 前置（Mac 上）：
#   - 安装 Xcode（App Store）并打开一次完成命令行工具安装
#   - 安装 Node 18+ 与 CocoaPods：  brew install node cocoapods
#   - 用数据线连接 iPad，并在 Xcode → 设置 → Accounts 登录 Apple ID
#
# 用法（在 Mac 上，项目根目录 app/ 下）：
#   bash scripts/build-ios.sh            # 仅同步原生工程 + pod install
#   bash scripts/build-ios.sh open       # 同步并用 Xcode 打开（推荐：连上 iPad 直接 Run 安装）
#   bash scripts/build-ios.sh ipa        # 导出 IPA（需要付费开发者账号 / 导出证书）
#
# 最简单真机安装（免费 Apple ID 即可）：
#   1) bash scripts/build-ios.sh open
#   2) Xcode 打开后，选 App 目标 → Signing & Capabilities → Team 选你的 Apple ID
#   3) 设备选你的 iPad Air → 点击 ▶ Run，自动装到设备
# =============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

command -v xcodebuild >/dev/null 2>&1 || { echo "❌ 未检测到 xcodebuild，请在 macOS + Xcode 下运行"; exit 1; }
command -v pod >/dev/null 2>&1 || { echo "❌ 未检测到 CocoaPods，请先 brew install cocoapods"; exit 1; }

echo "▶ 同步最新前端资源 + 原生依赖（pod install）…"
npx cap sync ios

case "${1:-}" in
  open)
    echo "▶ 用 Xcode 打开工程…"
    open ios/App/App.xcworkspace
    echo "然后选择 iPad 设备 + 你的 Apple ID Team，点击 Run 即可安装。"
    ;;
  ipa)
    WORKSPACE=ios/App/App.xcworkspace
    SCHEME=App
    ARCHIVE=$(mktemp -d)/L_Agent.xcarchive
    EXPORT=$(mktemp -d)
    PROFILE="${EXPORT_PROFILE:-}"   # 可选：指定分发证书/描述文件
    echo "▶ xcodebuild 归档…"
    xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release \
      -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" archive
    echo "▶ 导出 IPA（需已配置签名/分发证书）…"
    xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$EXPORT" \
      ${PROFILE:+-exportOptionsPlist "$PROFILE"}
    echo "✅ IPA 已导出到：$EXPORT"
    ;;
  *)
    echo "✅ iOS 原生工程已同步。运行 'bash scripts/build-ios.sh open' 用 Xcode 打开并安装到 iPad。"
    ;;
esac
