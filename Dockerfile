# Chromium only for v1 (see PROJECT_SPEC.md Critical Constraints). Base image
# already includes browsers + OS deps — no manual browser install steps.
# Tag must match the "playwright" npm package version pinned in package.json.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

# Android platform-tools (adb only) for v2 Appium/Android support — reaches an
# EXTERNAL emulator/device over ADB (host or LAN). No full Android SDK, no
# AVD/emulator bundled in this image (see PROJECT_SPEC.md v2 Critical
# Constraints / BRAINSTORMING_LOG_android.md Option C).
RUN apt-get update && apt-get install -y --no-install-recommends android-tools-adb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

EXPOSE 8765

CMD ["node", "dist/server.js"]
