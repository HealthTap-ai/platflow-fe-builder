# Makefile for platflowfrontendgen
# Provides simple commands for running the application with Docker

ACR_NAME := platflowfrontendgen
DOCKER_NAME := platflowfrontendgen
APP_NAME := platflow-frontend-gen
RESOURCE_GROUP := tap-ai-workflows-rg
GIT_COMMIT := $(shell git rev-parse --short HEAD)
GIT_BRANCH := $(shell git rev-parse --abbrev-ref HEAD)

DOCKER_TAG := "${ACR_NAME}.azurecr.io/images/${DOCKER_NAME}:${GIT_BRANCH}-${GIT_COMMIT}"

.PHONY: help docker-build docker-run docker-start azure-login azure-push azure-deploy

# Default target when running 'make' without arguments
help:
	@echo "Available commands:"
	@echo "  make docker-build    - Build the Docker image for bolt.diy"
	@echo "  make docker-run      - Run the bolt.diy container"
	@echo "  make docker-start    - Build and run the bolt.diy container"
	@echo "  make azure-login     - Login to Azure Container Registry"
	@echo "  make azure-push      - Push Docker image to Azure Container Registry"
	@echo "  make azure-deploy    - Deploy container to Azure App Service"
	@echo "  make help            - Show this help message"

one_time_login:
	az login

one_time_setup: one_time_login one_time_setup_azure_container_registry

one_time_setup_azure_container_registry:
	az acr login --name ${ACR_NAME}
	# Ref: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-authentication?tabs=azure-cli#admin-account
	az acr update -n ${ACR_NAME} --admin-enabled true

# Build the Docker image
docker-build:
	@echo "Building Docker image..."
	DOCKER_BUILDKIT=1 docker buildx build --platform linux/amd64 \
		--target platflow-frontend-gen-development \
		--build-arg COMMIT_HASH=${GIT_COMMIT} \
		-t ${DOCKER_TAG} .

# Run the bolt.diy container
docker-run:
	@echo "Starting bolt.diy container..."
	docker run -p 80:80 ${DOCKER_TAG}

# Build and then run the container
docker-start: docker-build docker-run 

# Login to Azure Container Registry
azure-login:
	@echo "Logging into Azure Container Registry..."
	az acr login --name $(ACR_NAME)

# Push Docker image to Azure Container Registry
azure-push: docker-build azure-login
	@echo "Pushing Docker image to Azure Container Registry..."
	docker push $(DOCKER_TAG)

# Deploy container to Azure App Service
azure-deploy: azure-push
	@echo "Deploying container to Azure App Service..."
	az webapp config container set --name $(APP_NAME) \
		--resource-group $(RESOURCE_GROUP) \
		--docker-custom-image-name $(DOCKER_TAG) \
		--docker-registry-server-url https://$(ACR_NAME).azurecr.io \