FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 5173

# Run Vite dev server exposing host for browser reachability
CMD ["npm", "run", "dev", "--", "--host"]
