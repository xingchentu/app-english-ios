#!/usr/bin/env bash
# =============================================================================
# L_Agent —— 打包 Android APK
#
# 说明：本应用依赖服务器（Claude CLI / 文件浏览 / 30 天资料都在服务器上）。
#       APK 把前端作为本地资源打包进 WebView，首次启动会提示填写服务器地址
#       （也可在顶栏齿轮里随时修改），所有接口以该绝对地址访问，跨域由服务端
#       CORS 放行。这样手机在任何网络、服务器 IP 怎么变都能连。
#
# 用法：bash scripts/build-apk.sh
# 产物：dist/L_Agent-<version>-debug.apk
# =============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

JDK_DIR="${JDK_DIR:-$HOME/.local/jdk17}"
SDK_DIR="${SDK_DIR:-$HOME/.local/android-sdk}"

log() { echo -e "\033[36m[L_Agent]\033[0m $*"; }
err() { echo -e "\033[31m[L_Agent]\033[0m $*"; }

need() { command -v "$1" >/dev/null 2>&1; }

# ---------------- 1. JDK 17 ----------------
if [ ! -x "$JDK_DIR/bin/java" ] || ! "$JDK_DIR/bin/java" -version >/dev/null 2>&1; then
  log "下载 JDK 17（清华大学 Adoptium 镜像）…"
  rm -rf "$JDK_DIR"
  mkdir -p "$JDK_DIR"
  JDK_TARBALL="$(mktemp /tmp/jdk17.XXXXXX.tar.gz)"
  # 动态解析最新版文件名，避免硬编码版本号失效
  JDK_URL="https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/linux/"
  JDK_FILE=$(curl -fsL "$JDK_URL" | grep -oE 'OpenJDK17U-jdk_x64_linux_hotspot_[0-9._]+tar\.gz' | head -1)
  if [ -z "$JDK_FILE" ]; then
    err "无法从镜像获取 JDK 文件名"
    exit 1
  fi
  log "JDK 文件：$JDK_FILE"
  curl -fL --retry 5 --retry-delay 3 -o "$JDK_TARBALL" "${JDK_URL}${JDK_FILE}"
  tar -xzf "$JDK_TARBALL" -C "$JDK_DIR" --strip-components=1
  rm -f "$JDK_TARBALL"
fi
export JAVA_HOME="$JDK_DIR"
export PATH="$JAVA_HOME/bin:$PATH"
if ! java -version >/dev/null 2>&1; then
  err "JDK 安装失败，请检查 $JDK_DIR"
  exit 1
fi
log "Java: $(java -version 2>&1 | head -1)"

# ---------------- 2. Android SDK ----------------
if [ ! -d "$SDK_DIR/platforms/android-34" ] || [ ! -d "$SDK_DIR/build-tools/34.0.0" ]; then
  log "下载 Android SDK（platform 34 / build-tools 34）…"
  mkdir -p "$SDK_DIR/cmdline-tools"
  CMDLINE_ZIP=/tmp/cmdline-tools.zip
  curl -fL --retry 3 -o "$CMDLINE_ZIP" \
    "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  rm -rf "$SDK_DIR/cmdline-tools/latest" "$SDK_DIR/cmdline-tools/cmdline-tools"
  mkdir -p "$SDK_DIR/cmdline-tools"
  (cd "$SDK_DIR/cmdline-tools" && python3 -c "
import zipfile,sys
zipfile.ZipFile('$CMDLINE_ZIP').extractall('.')
")
  # zip 根目录为 cmdline-tools/，移动到 latest/
  if [ -d "$SDK_DIR/cmdline-tools/cmdline-tools" ]; then
    mv "$SDK_DIR/cmdline-tools/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
  fi
  rm -f "$CMDLINE_ZIP"
  chmod +x "$SDK_DIR/cmdline-tools/latest/bin/"* 2>/dev/null || true
  export ANDROID_HOME="$SDK_DIR"
  export ANDROID_SDK_ROOT="$SDK_DIR"
  export PATH="$SDK_DIR/cmdline-tools/latest/bin:$PATH"
  yes | sdkmanager --licenses >/dev/null 2>&1 || true
  sdkmanager --install "platform-tools" "platforms;android-34" "build-tools;34.0.0" >/dev/null
fi
export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
export PATH="$SDK_DIR/cmdline-tools/latest/bin:$SDK_DIR/platform-tools:$PATH"

# ---------------- 3. Capacitor ----------------
# 系统 glibc 2.17 仅支持 Node 16，故使用支持 Node 16 的 Capacitor 5
log "安装 Capacitor 5 依赖（Node 16 兼容）…"
npm install --no-audit --no-fund --save-dev @capacitor/cli@5 @capacitor/core@5 @capacitor/android@5

# 写入配置：本地打包（不烘焙 server.url），保留 cleartext 允许明文 HTTP
node -e "
const fs=require('fs');
const p='capacitor.config.json';
const c=JSON.parse(fs.readFileSync(p,'utf8'));
c.server={cleartext:true};
fs.writeFileSync(p, JSON.stringify(c,null,2));
"

if [ ! -d android ]; then
  log "初始化 Android 工程…"
  npx cap add android
fi
log "同步 Web 资源…"
npx cap sync android

# 允许明文 HTTP（Android 9+ 默认禁止）
MANIFEST="android/app/src/main/AndroidManifest.xml"
if ! grep -q "usesCleartextTraffic" "$MANIFEST"; then
  python3 - "$MANIFEST" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace('<application', '<application\n        android:usesCleartextTraffic="true"', 1)
open(p, 'w', encoding='utf-8').write(s)
PY
  log "已开启 usesCleartextTraffic"
fi

# ---------------- 4. Gradle 构建 ----------------
log "开始 Gradle 构建（首次会下载 Gradle 与依赖，约 5-15 分钟）…"

# 4.1 Gradle 发行版走腾讯云镜像
WRAPPER="android/gradle/wrapper/gradle-wrapper.properties"
if [ -f "$WRAPPER" ] && ! grep -q "mirrors.cloud.tencent.com" "$WRAPPER"; then
  GRADLE_VER=$(grep distributionUrl "$WRAPPER" | sed -E 's/.*gradle-([0-9.]+)-.*/\1/')
  if [ -n "$GRADLE_VER" ]; then
    sed -i "s#distributionUrl=.*#distributionUrl=https\\\\://mirrors.cloud.tencent.com/gradle/gradle-${GRADLE_VER}-all.zip#" "$WRAPPER"
    log "Gradle wrapper 已切换到腾讯云镜像 (${GRADLE_VER})"
  fi
fi

# 4.2 Maven 依赖走阿里云镜像
INIT_DIR="$HOME/.gradle"
mkdir -p "$INIT_DIR/init.d"
export GRADLE_USER_HOME="$INIT_DIR"
cat > "$INIT_DIR/init.d/init-lagent.gradle" <<'GRADLE'
allprojects {
    repositories {
        maven { url 'https://maven.aliyun.com/repository/google' }
        maven { url 'https://maven.aliyun.com/repository/public' }
        maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }
        maven { url 'https://maven.aliyun.com/repository/central' }
    }
    buildscript {
        repositories {
            maven { url 'https://maven.aliyun.com/repository/google' }
            maven { url 'https://maven.aliyun.com/repository/public' }
            maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }
        }
    }
}
settingsEvaluated { settings ->
    try {
        def drm = settings.dependencyResolutionManagement
        drm.repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
        drm.repositories {
            maven { url 'https://maven.aliyun.com/repository/google' }
            maven { url 'https://maven.aliyun.com/repository/public' }
            maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }
            maven { url 'https://maven.aliyun.com/repository/central' }
        }
    } catch (Exception e) { /* 旧版 settings 忽略 */ }
}
GRADLE

cd android
chmod +x ./gradlew
./gradlew --no-daemon assembleDebug
cd "$APP_DIR"

mkdir -p dist
APK="dist/L_Agent-debug.apk"
cp android/app/build/outputs/apk/debug/app-debug.apk "$APK"
log "✅ 构建完成：$APP_DIR/$APK"
ls -lh "$APK"
