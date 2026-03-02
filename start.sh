#!/bin/bash

# Pokemon VNPET - Quick Start Script with Chat Feature
# This script sets up and starts both server and client

echo "🎮 Pokemon VNPET - Starting with Chat Feature..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

echo "✅ Node.js version: $(node -v)"
echo ""

# Check MongoDB connection
echo "🔍 Checking MongoDB connection..."
if ! nc -z localhost 27017 2>/dev/null; then
    echo "⚠️  Warning: MongoDB doesn't seem to be running on localhost:27017"
    echo "   Please start MongoDB before continuing."
    read -p "   Press Enter to continue anyway or Ctrl+C to exit..."
fi

# Setup Server
echo ""
echo "📦 Setting up Server..."
cd apps/server

if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found. Creating from .env.example..."
    cp .env.example .env
    echo "   Please edit apps/server/.env with your configuration"
fi

if [ ! -d "node_modules" ]; then
    echo "📥 Installing server dependencies..."
    npm install
else
    echo "✅ Server dependencies already installed"
fi

cd ../..

# Setup Client
echo ""
echo "📦 Setting up Client..."
cd apps/client

if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found. Creating from .env.example..."
    cp .env.example .env
fi

if [ ! -d "node_modules" ]; then
    echo "📥 Installing client dependencies..."
    npm install
else
    echo "✅ Client dependencies already installed"
fi

cd ../..

# Start both server and client
echo ""
echo "🚀 Starting server and client..."
echo ""
echo "   Server: http://localhost:5000"
echo "   Client: http://localhost:5173"
echo ""
echo "💬 Chat feature is enabled!"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Start in parallel using npm workspaces
npm run dev

echo ""
echo "👋 Servers stopped. Goodbye!"
