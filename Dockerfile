# Stage 1 — build the plugin bundle from source
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY plugin.meta.json tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN node scripts/build.mjs

# Stage 2 — static site + the freshly built plugin file
FROM nginx:1.27-alpine
COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY site/public /usr/share/nginx/html
COPY --from=build /app/dist/Retraced.plugin.js /usr/share/nginx/html/Retraced.plugin.js
