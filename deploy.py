import os
import re
import time
import subprocess

def auto_deploy():
    print("Starting automatic cache-bust and deployment...")
    
    # 1. Find the current styles file
    css_files = [f for f in os.listdir('.') if f.startswith('styles-') and f.endswith('.css')]
    if not css_files:
        print("Could not find styles CSS file.")
        return
        
    old_css = css_files[0]
    timestamp = int(time.time())
    new_css = f"styles-v{timestamp}.css"
    
    print(f"Renaming {old_css} to {new_css} to bust cache...")
    os.rename(old_css, new_css)
    
    # 2. Update HTML files
    html_files = [f for f in os.listdir('.') if f.endswith('.html')]
    for html_file in html_files:
        with open(html_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        content = content.replace(old_css, new_css)
        
        with open(html_file, 'w', encoding='utf-8') as f:
            f.write(content)
            
    # 3. Commit to Git
    print("Committing changes to Git...")
    subprocess.run(['git', 'add', '.'], check=True)
    subprocess.run(['git', 'commit', '-m', 'Auto cache-bust CSS'], check=True)
    subprocess.run(['git', 'push'], check=True)
    
    # 4. Deploy to Cloudflare
    print("Deploying to Cloudflare Pages...")
    # Use shell=True for npx on Windows
    subprocess.run('npx wrangler pages deploy . --project-name cool-cat-site --branch main', shell=True, check=True)
    subprocess.run('npx wrangler pages domain set cool-cat-site cool-cat.co.za', shell=True, check=True)
    
    print("===================================================")
    print(" DONE! Your website is live and the cache is busted!")
    print("===================================================")

if __name__ == '__main__':
    auto_deploy()
