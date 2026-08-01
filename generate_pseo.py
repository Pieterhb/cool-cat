import json
import os

def generate():
    print("Starting pSEO Generation...")
    
    # Ensure explore directory exists
    os.makedirs('explore', exist_ok=True)
    
    # Load data
    with open('data/locations.json', 'r', encoding='utf-8') as f:
        locations = json.load(f)
        
    # Load template
    with open('pseo_template.html', 'r', encoding='utf-8') as f:
        template = f.read()
        
    # Generate individual pages
    print(f"Generating {len(locations)} pSEO pages...")
    for loc in locations:
        page_content = template
        # Replace placeholders
        page_content = page_content.replace('{{slug}}', loc['slug'])
        page_content = page_content.replace('{{title}}', loc['title'])
        page_content = page_content.replace('{{landmark}}', loc['landmark'])
        page_content = page_content.replace('{{distance_km}}', loc['distance_km'])
        page_content = page_content.replace('{{driving_time}}', loc['driving_time'])
        page_content = page_content.replace('{{travel_tip}}', loc['travel_tip'])
        page_content = page_content.replace('{{intro_text}}', loc['intro_text'])
        
        # Save file
        output_path = os.path.join('explore', f"{loc['slug']}.html")
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(page_content)
            
    # Generate explore.html (Directory Page)
    print("Generating explore.html directory...")
    
    # We will read the CSS from pseo_template to ensure it uses the latest cache-busted css
    import re
    css_match = re.search(r'href="\.\./(styles-[^"]+\.css)"', template)
    css_file = css_match.group(1) if css_match else "styles-v1785582198.css"
    
    explore_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Explore Nearby | Cool Cat B&B</title>
    <meta name="description" content="Discover places to visit and stay near Cool Cat B&B in Strand, Western Cape.">
    <link rel="stylesheet" href="{css_file}">
    <style>
        .page-header {{
            background: linear-gradient(rgba(10, 58, 133, 0.5), rgba(15, 82, 186, 0.6)), url('2. Ocean.jpg') center/cover;
            padding: 8rem 0 4rem;
            text-align: center;
            color: white;
            margin-bottom: 3rem;
        }}
        .grid-3 {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
        }}
        .location-card {{
            background: var(--white);
            padding: 1.5rem;
            border-radius: 12px;
            box-shadow: var(--shadow-sm);
            border-left: 4px solid var(--orange);
            transition: transform 0.2s ease;
        }}
        .location-card:hover {{
            transform: translateY(-5px);
            box-shadow: var(--shadow-md);
        }}
        .location-card h3 {{
            font-size: 1.2rem;
            margin-bottom: 0.5rem;
        }}
    </style>
</head>
<body>
    <header id="navbar">
        <div class="container nav-container">
            <a href="index.html" class="logo-wrapper">
                <img src="Logo.png" alt="Cool Cat B&B Logo" class="logo-img">
                <span class="logo-text">COOL CAT B&B</span>
            </a>
            <nav>
                <div class="mobile-menu-btn" onclick="document.getElementById('navLinks').classList.toggle('active')">☰</div>
                <ul class="nav-links" id="navLinks">
                    <li><a href="index.html">Home</a></li>
                    <li><a href="rooms.html">Accommodation</a></li>
                    <li><a href="guide.html">Guest Guide</a></li>
                    <li><a href="faq.html">FAQ & Policies</a></li>
                    <li><a href="#" onclick="openEmail('bookings@cool-cat.co.za','Booking Inquiry');return false;" class="btn btn-primary" style="padding: 0.5rem 1.5rem; color: white;">Book Now</a></li>
                </ul>
            </nav>
        </div>
    </header>

    <div class="page-header">
        <div class="container">
            <h1 style="color: white; font-size: clamp(2rem, 8vw, 3rem); word-break: break-word;">Explore the Western Cape</h1>
            <p style="font-size: 1.2rem; max-width: 600px; margin: 0 auto;">Discover top destinations, transit hubs, and beautiful locations near Cool Cat B&B.</p>
        </div>
    </div>

    <section class="section" style="padding-top: 0;">
        <div class="container">
            <div class="grid-3">
"""
    for loc in locations:
        explore_content += f"""
                <a href="explore/{loc['slug']}.html" class="location-card">
                    <h3>{loc['landmark']}</h3>
                    <p style="color: var(--text-light); font-size: 0.9rem; margin-bottom: 0.5rem;">{loc['distance_km']} away</p>
                    <p style="color: var(--sapphire-blue); font-size: 0.9rem; font-weight: 500;">View Accommodation →</p>
                </a>
"""
    explore_content += """
            </div>
        </div>
    </section>
    
    <footer>
        <div class="container">
            <div class="footer-grid">
                <div class="footer-col">
                    <h3>Cool Cat B&B</h3>
                    <p>Your premium bed and breakfast experience in the beautiful coastal town of Strand, Western Cape, South Africa.</p>
                </div>
                <div class="footer-col">
                    <h3>Contact Us</h3>
                    <ul>
                        <li>📱 <a href="tel:0637124491">063 712 4491 (Michele Rossouw)</a></li>
                        <li>💬 <a href="https://wa.me/27637124491" target="_blank">WhatsApp Us</a></li>
                        <li>✉️ <a href="#" onclick="openEmail('bookings@cool-cat.co.za','Booking Inquiry');return false;">bookings@cool-cat.co.za</a></li>
                    </ul>
                </div>
                <div class="footer-col">
                    <h3>Quick Links</h3>
                    <ul>
                        <li><a href="rooms.html">Our Rooms</a></li>
                        <li><a href="guide.html">Guest Guide & Menus</a></li>
                        <li><a href="explore.html">Explore Nearby</a></li>
                    </ul>
                </div>
            </div>
            <div class="footer-bottom">
                &copy; <script>document.write(new Date().getFullYear())</script> Cool Cat B&B. All rights reserved.
            </div>
        </div>
    </footer>
    <script>
        function openEmail(address, subject) {
            var isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
            var subjectEncoded = encodeURIComponent(subject);
            if (isMobile) {
                window.location.href = 'mailto:' + address + '?subject=' + subjectEncoded;
            } else {
                window.open('https://mail.google.com/mail/?view=cm&fs=1&to=' + address + '&su=' + subjectEncoded, '_blank');
            }
        }
    </script>
</body>
</html>
"""
    with open('explore.html', 'w', encoding='utf-8') as f:
        f.write(explore_content)
        
    # Generate sitemap.xml
    print("Generating sitemap.xml...")
    base_url = "https://cool-cat.co.za"
    sitemap = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>{base_url}/</loc></url>
    <url><loc>{base_url}/index.html</loc></url>
    <url><loc>{base_url}/rooms.html</loc></url>
    <url><loc>{base_url}/guide.html</loc></url>
    <url><loc>{base_url}/faq.html</loc></url>
    <url><loc>{base_url}/explore.html</loc></url>
"""
    for loc in locations:
        sitemap += f"    <url><loc>{base_url}/explore/{loc['slug']}.html</loc></url>\n"
        
    sitemap += "</urlset>"
    
    with open('sitemap.xml', 'w', encoding='utf-8') as f:
        f.write(sitemap)
        
    print("=========================================")
    print(" pSEO Generation Complete!")
    print("=========================================")

if __name__ == "__main__":
    generate()
