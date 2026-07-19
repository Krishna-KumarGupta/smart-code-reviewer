#!/bin/sh

# Start Redis Server in the background
echo "🚀 Starting Redis Server..."
redis-server --protected-mode no &

# Start backend API in the background
echo "🚀 Starting Backend API..."
cd /app/backend && npm start &

# Start frontend UI (Vite dev server) in the foreground
echo "🚀 Starting Frontend UI..."
cd /app/frontend && npm run dev -- --host
