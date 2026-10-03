# Use Python commands directly on Windows if GNU Make is not installed.
ifeq ($(OS),Windows_NT)
PYTHON ?= .venv/Scripts/python.exe
else
PYTHON ?= .venv/bin/python
endif

.PHONY: up down migrate makemigration test lint fe-test fe-lint fe-build traceability verify

up down migrate test lint fe-test fe-lint fe-build traceability verify:
	"$(PYTHON)" scripts/dev.py $@

makemigration:
	"$(PYTHON)" scripts/dev.py makemigration --name "$(name)"
