#!/bin/bash

# Grantha API Deployment Script
# Usage: ./deploy.sh [platform]
# Platforms: vercel, render, railway, digitalocean, docker

PLATFORM=${1:-vercel}

echo "🚀 Deploying Grantha API..."

case $PLATFORM in
  vercel)
    echo "Deploying to Vercel..."
    npm install -g vercel
    vercel --prod
    ;;
    
  render)
    echo "Deploying to Render..."
    # Requires render.yaml
    curl -X POST "https://api.render.com/v1/services" -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" -d @render.json
    ;;
    
  railway)
    echo "Deploying to Railway..."
    npm install -g @railway/cli
    railway login
    railway init
    railway up
    ;;
    
  docker)
    echo "Building Docker image..."
    docker build -t grantha-api .
    docker run -p 3000:3000 -e DATABASE_URL="$DATABASE_URL" grantha-api
    ;;
    
  digitalocean)
    echo "Deploying to DigitalOcean App Platform..."
    doctl apps create --spec spec.yaml
    ;;
    
  *)
    echo "Usage: ./deploy.sh [vercel|render|railway|digitalocean|docker]"
    exit 1
    ;;
esac

echo "✅ Deployment complete!"
