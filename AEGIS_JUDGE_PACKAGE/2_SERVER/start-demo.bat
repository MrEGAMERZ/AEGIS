@echo off
:: Aegis one-shot demo starter (double-click friendly wrapper for start-demo.ps1)
:: Pass "mock" to skip the model:  start-demo.bat mock
set FLAG=
if /I "%1"=="mock" set FLAG=-Mock
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-demo.ps1" %FLAG%