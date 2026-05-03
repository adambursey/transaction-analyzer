# Stage 1: Build the Vite app and compile TypeScript
FROM node:22-slim AS builder

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the frontend and backend (if needed)
# Vite build will output to dist/
RUN npm run build

# Stage 2: Production environment
FROM node:22-slim

WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built assets and server file from builder
COPY --from=builder /app/dist ./dist
COPY server.ts ./

# We need tsx to run server.ts since it's TypeScript
# Alternatively we could compile server.ts to JS in the builder stage,
# but using tsx is the current approach in package.json.
# We will install tsx globally for the runner
RUN npm install -g tsx typescript

# Expose the port (Cloud Run sets the PORT env var, defaults to 8080 or 3000)
ENV PORT=3000
EXPOSE $PORT

# Start the application
CMD ["tsx", "server.ts"]
