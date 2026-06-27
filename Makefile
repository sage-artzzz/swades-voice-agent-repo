# ── Configuration ──────────────────────────────────────────────────────────────
# Override any of these at the command line:
#   make up FRONTEND_PORT=4000 BACKEND_PORT=9000
FRONTEND_PORT  ?= 3000
BACKEND_PORT   ?= 8000
COMPOSE        := docker compose

# ── Targets ────────────────────────────────────────────────────────────────────
.PHONY: up down restart build logs logs-api logs-agent logs-frontend status clean help

help: ## Show this help
	@echo "Usage: make [target] [VAR=value]"
	@echo ""
	@echo "Configurable variables (current values):"
	@echo "  FRONTEND_PORT = $(FRONTEND_PORT)"
	@echo "  BACKEND_PORT  = $(BACKEND_PORT)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

up: ## Build and start all services
	FRONTEND_PORT=$(FRONTEND_PORT) BACKEND_PORT=$(BACKEND_PORT) \
		$(COMPOSE) up --build -d
	@echo ""
	@echo "Services running:"
	@echo "  Caller UI    → http://localhost:$(FRONTEND_PORT)"
	@echo "  Monitor      → http://localhost:$(FRONTEND_PORT)/monitor"
	@echo "  Appointments → http://localhost:$(FRONTEND_PORT)/appointments"
	@echo "  Backend API  → http://localhost:$(BACKEND_PORT)"

down: ## Stop all services
	$(COMPOSE) down

restart: down up ## Stop, rebuild, and start all services

build: ## Rebuild images without starting
	$(COMPOSE) build

logs: ## Follow logs from all services
	$(COMPOSE) logs -f

logs-api: ## Follow API logs only
	$(COMPOSE) logs -f api

logs-agent: ## Follow agent logs only
	$(COMPOSE) logs -f agent

logs-frontend: ## Follow frontend logs only
	$(COMPOSE) logs -f frontend

status: ## Show container status
	$(COMPOSE) ps

clean: ## Stop services and remove volumes (wipes database)
	$(COMPOSE) down -v
