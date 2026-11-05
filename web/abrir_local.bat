@echo off
rem Abre la web en tu ordenador (hace falta Python). Cierra esta ventana para parar.
cd /d "%~dp0"
start "" http://localhost:8000
python -m http.server 8000
