# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY backend/package.json backend/pnpm-lock.yaml* ./

# Install pnpm and dependencies
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source and prisma
COPY backend/ .

# Generate Prisma client (needs dummy DATABASE_URL)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate

# Build
RUN pnpm build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install build dependencies for native modules (bcrypt) and OpenSSL for Prisma
RUN apk add --no-cache python3 make g++ openssl openssl-dev libc6-compat

# Install pnpm
RUN npm install -g pnpm

# Copy package files and install production deps (rebuild native modules)
COPY backend/package.json backend/pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod
RUN npm rebuild bcrypt --build-from-source

# Copy Prisma schema and generate client using same version from package.json
COPY backend/prisma ./prisma
RUN npx prisma@5.22.0 generate

# Copy built files
COPY --from=builder /app/dist ./dist

EXPOSE 3004

CMD ["node", "dist/src/main.js"]
