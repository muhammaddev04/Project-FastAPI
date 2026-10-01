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

RUN printf '%s\n' \
'server {' \
'    listen 80;' \
'    server_name _;' \
'    root /usr/share/nginx/html;' \
'    index index.html;' \
'' \
'    location / {' \
'        try_files $uri $uri/ /index.html;' \
'    }' \
'}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
