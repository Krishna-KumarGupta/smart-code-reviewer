FROM node:22-alpine

WORKDIR /app

# Install build dependencies if any native addons require them
RUN apk add --no-cache python3 make g++

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 5000

CMD ["npm", "run", "start"]
