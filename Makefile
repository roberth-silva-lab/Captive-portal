.PHONY: test lint typecheck audit build compose-config

test:
	cd backend && pytest

lint:
	cd backend && ruff check app tests

typecheck:
	cd backend && mypy app

audit:
	cd backend && bandit -r app && pip-audit -r requirements.txt

build:
	docker compose build

compose-config:
	docker compose config
