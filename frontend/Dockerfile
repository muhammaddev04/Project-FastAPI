# TezFarmo web production image: Vite build, then the static bundle on nginx.
# The bundle calls the API at the relative path /api/v1 (src/shared/api/client.ts), so there is no
# build-time API URL: the host nginx serves this container on / and the API on /api/ from the same origin.
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# nginx:alpine ships with gzip commented out, which would put the whole uncompressed bundle on the
# wire. Hashed /assets/ names can be cached forever; /media/ and /brand/ keep stable names, so they
# get a day. index.html must stay revalidated or it would keep pointing at retired asset hashes.
RUN printf '%s\n' \
'server {' \
'    listen 80;' \
'    server_name _;' \
'    root /usr/share/nginx/html;' \
'    index index.html;' \
'' \
'    gzip on;' \
'    gzip_vary on;' \
'    gzip_min_length 1024;' \
'    gzip_comp_level 6;' \
'    gzip_types text/plain text/css application/javascript application/json image/svg+xml;' \
'' \
'    location /assets/ {' \
'        add_header Cache-Control "public, max-age=31536000, immutable";' \
'        try_files $uri =404;' \
'    }' \
'' \
'    location ~ ^/(media|brand)/|^/favicon\.svg$ {' \
'        add_header Cache-Control "public, max-age=86400";' \
'        try_files $uri =404;' \
'    }' \
'' \
'    location / {' \
'        add_header Cache-Control "no-cache";' \
'        try_files $uri $uri/ /index.html;' \
'    }' \
'}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
