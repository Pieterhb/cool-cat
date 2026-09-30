@echo off
echo ===================================================
echo   Cool-Cat Backup + Deploy to cool-cat.co.za
echo ===================================================
echo.

REM --- Prompt for a commit message ---
set /p MSG="Enter a short description of your changes: "
if "%MSG%"=="" set MSG=Manual backup and deploy

echo.
echo Step 1: Staging all changed files...
git add -A

echo.
echo Step 2: Committing to Git...
git commit -m "%MSG%"

echo.
echo Step 3: Pushing to GitHub (backup)...
git push origin main

echo.
echo Step 4: Deploying via Wrangler to cool-cat.co.za ...
echo (using project: cool-cat-site PRODUCTION branch linked to cool-cat.co.za)
call npx wrangler pages deploy . --project-name cool-cat-site --branch production --commit-dirty=true

echo.
echo ===================================================
echo   DONE!
echo   - GitHub: backed up to Pieterhb/cool-cat
echo   - Live site: cool-cat.co.za (via cool-cat-site project)
echo ===================================================
pause
