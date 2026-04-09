FROM node:18

# Install system dependencies
RUN apt-get update && \
    apt-get install -y ffmpeg python3-pip && \
    pip3 install yt-dlp

# App setup
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]