FROM node:22-slim AS builder

WORKDIR /app

COPY package.json ./
COPY prisma ./prisma/
RUN npm install
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/
RUN npx tsc

FROM node:22-slim AS runner

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/prisma ./prisma/

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
