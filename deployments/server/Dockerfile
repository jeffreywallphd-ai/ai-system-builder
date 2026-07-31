FROM node:24-bookworm-slim@sha256:b31e7a42fdf8b8aa5f5ed477c72d694301273f1069c5a2f71d53c6482e99a2fc AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/thin-client/package.json apps/thin-client/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY apps/server apps/server
COPY modules modules
RUN npm run build:server

FROM node:24-bookworm-slim@sha256:b31e7a42fdf8b8aa5f5ed477c72d694301273f1069c5a2f71d53c6482e99a2fc AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/thin-client/package.json apps/thin-client/package.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/modules/adapters/runtime/python/worker ./modules/adapters/runtime/python/worker
RUN mkdir -p /var/lib/ai-system-builder/artifacts /var/lib/ai-system-builder/runtime \
  && chown -R node:node /var/lib/ai-system-builder

USER node
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('https').get({hostname:'127.0.0.1',port:process.env.PORT||3010,path:'/health/ready',rejectUnauthorized:false},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/apps/server/src/index.js"]
