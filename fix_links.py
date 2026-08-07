import os

directory = r"c:\coolcat"

for root, dirs, files in os.walk(directory):
    for file in files:
        if file.endswith(".html"):
            filepath = os.path.join(root, file)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                
                # Replace Logo references
                new_content = content.replace('src="Logo-v2.png"', 'src="Logo.png?v=3"')
                new_content = new_content.replace('href="/Logo-v2.png"', 'href="/Logo.png?v=3"')
                new_content = new_content.replace('href="Logo-v2.png"', 'href="Logo.png?v=3"')
                
                # In case they were already changed back by user
                new_content = new_content.replace('src="Logo.png"', 'src="Logo.png?v=3"')
                new_content = new_content.replace('src="Logo.png?v=3?v=3"', 'src="Logo.png?v=3"')

                # Replace Favicon references
                new_content = new_content.replace('href="/favicon-v2.ico"', 'href="/Favicon.png?v=3"')
                new_content = new_content.replace('href="/apple-touch-icon-v2.png"', 'href="/Favicon.png?v=3"')
                new_content = new_content.replace('type="image/x-icon"', 'type="image/png"')
                
                if new_content != content:
                    with open(filepath, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    print(f"Updated {filepath}")
            except Exception as e:
                print(f"Failed {filepath}: {e}")
