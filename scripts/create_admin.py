"""Wrapper seguro para criar administrador interativamente.

Uso: python scripts/create_admin.py
"""
from app.cli.__main__ import create_admin

if __name__ == "__main__":
    raise SystemExit(create_admin())
