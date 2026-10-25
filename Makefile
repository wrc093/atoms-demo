.PHONY: dev backend frontend build check test

dev:
	python3 -m backend

backend:
	FORMA_SERVE_FRONTEND=0 python3 -m backend

frontend:
	npm --prefix frontend run dev

build:
	npm --prefix frontend run build

check:
	npm --prefix frontend run check

# The backend tests use temporary databases and mock model services.
test:
	python3 -m unittest discover -s backend/tests -v
	npm --prefix frontend test
