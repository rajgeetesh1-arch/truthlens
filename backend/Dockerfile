FROM node:20

# Install Python and system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy backend files
COPY . .

# Install Node dependencies
RUN npm install

# Install Python dependencies
RUN pip3 install transformers torch huggingface_hub yt-dlp --break-system-packages

# Expose port
ENV PORT=10000
EXPOSE 10000

CMD ["node", "server.js"]