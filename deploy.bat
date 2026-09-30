@echo off
echo ===================================================
echo   Cool-Cat Backup + Deploy
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
echo Step 3: Pushing to GitHub --^> triggers Cloudflare deploy to cool-cat.co.za ...
git push origin main

echo.
echo Step 4: Also deploying directly via Wrangler (preview URL)...
call npx wrangler pages deploy . --project-name cool-cat --commit-dirty=true

echo.
echo ===================================================
echo   DONE!
echo   - GitHub pushed   -^> cool-cat.co.za (via Cloudflare Pages auto-deploy)
echo   - Wrangler deploy -^> preview .pages.dev URL
echo ===================================================
pause
