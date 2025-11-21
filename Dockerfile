# Use the official Node.js 18 image as a base
FROM node:18

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install && npm rebuild bcrypt --build-from-source

# Copy the rest of the application code
COPY . .

# Generate Prisma client with correct binary
RUN npx prisma generate

# Compile TypeScript code
RUN npm run build

ENV PRISMA_ENABLE_TRACING=true
ENV PRISMA_LOG_LEVEL=query
ENV RUST_BACKTRACE=full

# Expose the port that the app runs on
EXPOSE 3000

# Start the application
CMD ["node", "dist/index.js"]
