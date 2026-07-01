# Chromium only for v1 (see PROJECT_SPEC.md Critical Constraints). Base image
# already includes browsers + OS deps — no manual browser install steps.
# Tag must match the "playwright" npm package version pinned in package.json.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

EXPOSE 8765

CMD ["node", "dist/server.js"]
