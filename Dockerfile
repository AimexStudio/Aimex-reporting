# Production image for Google Cloud Run (or any container host).
# Build:  gcloud run deploy --source .   (Cloud Build uses this file)

FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build \
 && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    NEXT_TELEMETRY_DISABLED=1
# Only what's needed to run: the built app, production packages and public files.
COPY --from=build --chown=node:node /app/package.json /app/next.config.mjs ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 8080
# Cloud Run sets PORT; Next.js listens on it.
CMD ["node_modules/.bin/next", "start"]
