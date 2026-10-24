# ── Stage 1: Build the React app ─────────────────────────────────────────────
# Runs on the build host's native arch (output is static files, arch-independent)
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# nginx serves the static React bundle.
# Node runs the CLM API server (server/index.ts) on port 3001.
# nginx proxies /api/* to Node so the browser always talks to the same origin.
FROM --platform=linux/amd64 node:22-alpine

# Upgrade all packages to pull in latest security patches
RUN apk upgrade --no-cache && apk add --no-cache nginx

WORKDIR /app

# Copy built React app
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy prod node_modules built natively in stage 1 (avoids slow emulated npm ci)
COPY --from=builder /app/node_modules ./node_modules

# Copy API server source
COPY server/ ./server/

# nginx config:
#  • /api/ → reverse proxy to Node API server on port 3001
#  • everything else → SPA static files with fallback to index.html
RUN printf 'server {\n\
    listen 8080;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    # API proxy: browser calls /api/* → Node server on 3001 → agentOS\n\
    # Server-to-server means Mixed Content and CORS are never an issue.\n\
    location /api/ {\n\
        proxy_pass http://127.0.0.1:3001;\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
        proxy_set_header X-Forwarded-Proto $scheme;\n\
        proxy_read_timeout 300s;\n\
        proxy_send_timeout 300s;\n\
    }\n\
\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/http.d/default.conf

# Entrypoint: start the Node API server then nginx in the foreground
RUN printf '#!/bin/sh\n\
set -e\n\
echo "Starting CLM API server..."\n\
node --experimental-strip-types /app/server/index.ts &\n\
echo "Starting nginx..."\n\
exec nginx -g "daemon off;"\n' > /app/start.sh && chmod +x /app/start.sh

EXPOSE 8080

CMD ["/app/start.sh"]
