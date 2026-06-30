# Build stage
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
# Copy proto to absolute container root /proto
COPY proto /proto
RUN npm run build

# Production stage
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production
COPY --from=builder /app/dist ./dist
# Copy static web assets to serve the GUI Dashboard
COPY public ./public
# Copy proto from builder absolute /proto to production absolute /proto
COPY --from=builder /proto /proto
EXPOSE 8080
CMD ["npm", "start"]
