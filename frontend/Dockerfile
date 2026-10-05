# ---- builder (Vite + React) ----
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Baked in at build time (Vite VITE_* vars are static).
ARG VITE_API_BASE_URL=/api/upstream
ARG VITE_WS_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_WS_BASE_URL=$VITE_WS_BASE_URL

RUN npm run build

# ---- runtime (static + reverse proxy to backend) ----
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
