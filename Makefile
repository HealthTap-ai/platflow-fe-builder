# Makefile for bolt.diy
# Provides simple commands for running the application with Docker

.PHONY: help docker-build docker-run docker-start

# Default target when running 'make' without arguments
help:
	@echo "Available commands:"
	@echo "  make docker-build  - Build the Docker image for bolt.diy"
	@echo "  make docker-run    - Run the bolt.diy container"
	@echo "  make docker-start  - Build and run the bolt.diy container"
	@echo "  make help          - Show this help message"

# Build the Docker image
docker-build:
	@echo "Building Docker image..."
	docker build . --target bolt-ai-development

# Run the bolt.diy container
docker-run:
	@echo "Starting bolt.diy container..."
	docker compose --profile development up

# Build and then run the container
docker-start: docker-build docker-run 