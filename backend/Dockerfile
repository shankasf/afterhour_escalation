FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update -qq \
  && apt-get install -y -qq openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY nest-cli.json tsconfig*.json ./
COPY src ./src
RUN npm run build

EXPOSE 3004

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
