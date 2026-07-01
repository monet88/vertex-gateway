FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --omit=optional

FROM deps AS compile
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=compile /app/compiled ./compiled
COPY package.json ./package.json
CMD ["node", "compiled/server.js"]
