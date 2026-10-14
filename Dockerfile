# Stage 1: Build
# Runs on the build host's native arch (output is static files, arch-independent),
# so cross-building for amd64 on Apple Silicon doesn't emulate npm.
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Serve
# Pin the platform explicitly: Code Engine is linux/amd64, and podman 5.0.2 on
# Apple Silicon was resolving an arm64 nginx despite `build --platform`.
FROM --platform=linux/amd64 nginx:stable-alpine

# Upgrade all packages to pull in latest security patches
# (fixes CVEs in libpng, tiff, libexpat, zlib, nghttp2-libs, pcre2)
RUN apk upgrade --no-cache

COPY --from=builder /app/dist /usr/share/nginx/html

# SPA fallback: route all requests to index.html
RUN printf 'server {\n\
    listen 8080;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
