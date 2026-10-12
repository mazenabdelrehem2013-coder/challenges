# One container runs everything: the API, the manager/HR dashboard (/admin)
# and the web version of the employee app (/).

FROM node:22-bookworm AS dashboard
WORKDIR /src/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npx vite build --outDir /out/admin

FROM node:22-bookworm AS phone
WORKDIR /src/mobile
COPY mobile/package*.json ./
RUN npm ci
COPY mobile/ ./
RUN EXPO_PUBLIC_API_URL=same-origin CI=1 npx expo export --platform web --output-dir /out/app

FROM node:22-bookworm-slim AS backend
WORKDIR /srv/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/src ./src

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4000 DB_FILE=/data/challenges.db PUBLIC_DIR=/srv/public
WORKDIR /srv/backend
COPY --from=backend /srv/backend ./
COPY --from=dashboard /out/admin /srv/public/admin
COPY --from=phone /out/app /srv/public/app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4000
CMD ["node", "src/server.js"]
