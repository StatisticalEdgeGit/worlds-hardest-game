# Build from the repo root: docker compose builds this with context "." so the
# game files (served to players, and js/levels.js used by the replay check) are included.
FROM node:22-alpine

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/ ./
COPY index.html style.css sw.js manifest.webmanifest icon.svg icon-192.png icon-512.png /app/public/
COPY js/ /app/public/js/

ENV NODE_ENV=production \
    GAME_DIR=/app/public \
    PORT=8080
EXPOSE 8080
USER node
CMD ["node", "src/index.js"]
