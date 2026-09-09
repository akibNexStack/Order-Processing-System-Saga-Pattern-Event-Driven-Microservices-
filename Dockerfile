FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY services/payment-service/package.json services/payment-service/package.json
COPY services/inventory-service/package.json services/inventory-service/package.json
COPY services/shipping-service/package.json services/shipping-service/package.json
COPY services/order-orchestrator/package.json services/order-orchestrator/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/services ./services
COPY --from=build --chown=node:node /app/apps/web ./apps/web
COPY --from=build --chown=node:node /app/scripts ./scripts
USER node
EXPOSE 3004
CMD ["node", "node_modules/next/dist/bin/next", "start", "apps/web", "--hostname", "0.0.0.0", "--port", "3004"]
