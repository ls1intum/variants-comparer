# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM base AS build
# Overrides the default in client/.env only when passed (an unset ARG is not exported to RUN)
ARG VITE_PROXY_BASE
COPY --from=deps /app/node_modules ./node_modules
COPY . ./
RUN npm run build

FROM nginx:1.27-alpine AS runner
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
