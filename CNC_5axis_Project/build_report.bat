@echo off
REM Double-click to rebuild IA3_REPORT_CNC.docx (needs Node.js; first run installs the docx package).
cd /d "%~dp0report"
if not exist node_modules call npm install
node build_report.js
pause
