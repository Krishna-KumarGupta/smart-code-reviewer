FROM node:22-alpine
<<<<<<< HEAD

WORKDIR /app

# Install build dependencies if any native addons require them
RUN apk add --no-cache python3 make g++

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 5000

CMD ["npm", "run", "start"]
=======
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
>>>>>>> 90e2b07da74895062afe63ca6fbca3a214ffddf3
