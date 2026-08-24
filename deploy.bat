@echo off
echo ===================================================
echo   Deploying Cool-Cat Website to Cloudflare Pages...
echo ===================================================
echo.
echo Step 1: Uploading files...
echo (If a browser window opens, please log in to Cloudflare and click "Allow")
echo.
call npx wrangler pages deploy . --project-name cool-cat-site --branch main

echo.
echo Step 2: Linking your custom domain (cool-cat.co.za)...
echo.
call npx wrangler pages domain set cool-cat-site cool-cat.co.za

echo.
echo ===================================================
echo   DONE! Your website should be live shortly!
echo ===================================================
pause
