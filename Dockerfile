FROM node:24-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.cjs ./
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY server.js ./
COPY src ./src
COPY public ./public
COPY prisma ./prisma
COPY prisma.config.cjs ./
COPY data/product-images/ ./data/product-images/

USER node
CMD ["node", "server.js"]
