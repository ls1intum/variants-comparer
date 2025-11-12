# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache git

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=4000
ENV ALLOWED_BASE_DIR=/data
ENV CONFIG_PATH=/app/storage/config.json
# Create the data directory and set permissions
RUN mkdir -p /data && chown -R node:node /data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
COPY storage ./storage
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
