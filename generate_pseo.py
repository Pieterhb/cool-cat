import json
import os
import re
import datetime

def generate():
    print("Starting Enhanced pSEO Generation...")
    
    # Ensure explore directory exists
    os.makedirs('explore', exist_ok=True)
    
    # Load data
    with open('data/locations.json', 'r', encoding='utf-8') as f:
        locations = json.load(f)
        
    loc_by_slug = {loc['slug']: loc for loc in locations}
        
    # Load template
    with open('pseo_template.html', 'r', encoding='utf-8') as f:
        template = f.read()
        
    # Find latest CSS file
    css_files = [f for f in os.listdir('.') if f.startswith('styles-') and f.endswith('.css')]
    css_file = css_files[0] if css_files else "styles-v1787671426.css"
    
    today = datetime.date.today().isoformat()
    
    # 1. Generate individual pSEO pages
    print(f"Generating {len(locations)} pSEO destination pages...")
    for loc in locations:
        page_content = template
        
        # Build highlights HTML
        highlights_html = "\n".join([f"<li>{h}</li>" for h in loc.get('highlights', [])])
        
        # Build related cards HTML
        related_cards = []
        for rel_slug in loc.get('related_slugs', []):
            if rel_slug in loc_by_slug:
                rel = loc_by_slug[rel_slug]
                related_cards.append(f"""
                    <a href="/explore/{rel['slug']}" class="related-card">
                        <span style="font-size: 0.78rem; font-weight: 700; color: var(--orange); text-transform: uppercase;">{rel.get('category', 'Attraction')}</span>
                        <h4 style="margin: 0.3rem 0; font-size: 0.98rem; color: var(--sapphire-blue-dark);">{rel['landmark']}</h4>
                        <p style="font-size: 0.85rem; color: var(--text-light); margin: 0;">{rel['distance_km']} away ({rel['driving_time']})</p>
                    </a>
                """)
        related_html = "".join(related_cards)
        
        # Replace placeholders
        page_content = page_content.replace('{{slug}}', loc['slug'])
        page_content = page_content.replace('{{title}}', loc['title'])
        page_content = page_content.replace('{{landmark}}', loc['landmark'])
        page_content = page_content.replace('{{category}}', loc.get('category', 'Attractions & Leisure'))
        page_content = page_content.replace('{{distance_km}}', loc['distance_km'])
        page_content = page_content.replace('{{driving_time}}', loc['driving_time'])
        page_content = page_content.replace('{{route_directions}}', loc.get('route_directions', 'Conveniently accessible from Cool-Cat in Strand.'))
        page_content = page_content.replace('{{travel_tip}}', loc['travel_tip'])
        page_content = page_content.replace('{{intro_text}}', loc['intro_text'])
        page_content = page_content.replace('{{highlights_html}}', highlights_html)
        page_content = page_content.replace('{{recommended_room}}', loc.get('recommended_room', 'King Arthur Room or Deluxe Suite'))
        page_content = page_content.replace('{{best_for}}', loc.get('best_for', 'Holidaymakers, weekend travelers, and exploring False Bay'))
        page_content = page_content.replace('{{faq_question}}', loc.get('faq_question', f"How far is Cool-Cat from {loc['landmark']}?"))
        page_content = page_content.replace('{{faq_answer}}', loc.get('faq_answer', f"{loc['landmark']} is located approximately {loc['distance_km']} from Cool-Cat in Strand."))
        page_content = page_content.replace('{{related_html}}', related_html)
        page_content = page_content.replace('{{image_url}}', loc.get('image_url', '../1. Dining Breakfast.jpg'))
        page_content = page_content.replace('{{image_alt}}', loc.get('image_alt', f"{loc['landmark']} – near Cool-Cat Strand B&B"))
        
        # Update CSS path
        page_content = re.sub(r'href="\.\./styles-[^"]+\.css"', f'href="../{css_file}"', page_content)
        
        # Save file
        output_path = os.path.join('explore', f"{loc['slug']}.html")
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(page_content)
            
    # 2. Generate explore.html (Categorized Directory Page)
    print("Generating categorized explore.html directory...")
    
    # Group by category
    categories = [
        ("Beaches & Coastal", "🏖️"),
        ("Wine & Dine", "🍷"),
        ("Nature & Hiking", "🥾"),
        ("Golf Courses", "⛳"),
        ("Adventure Sports", "🏄"),
        ("Family & Wildlife", "🐾"),
        ("Shopping & Essentials", "🛍️"),
        ("Medical Facilities", "🏥")
    ]
    
    cat_sections_html = ""
    for cat_name, icon in categories:
        cat_locs = [l for l in locations if l.get('category') == cat_name]
        if not cat_locs:
            continue
            
        cards_html = ""
        for loc in cat_locs:
            cards_html += f"""
                <a href="/explore/{loc['slug']}" class="location-card">
                    <span style="font-size: 0.78rem; font-weight: 700; color: var(--orange); text-transform: uppercase;">{cat_name}</span>
                    <h3 style="margin: 0.4rem 0 0.3rem; font-size: 1.15rem; color: var(--sapphire-blue-dark);">{loc['landmark']}</h3>
                    <p style="color: var(--text-light); font-size: 0.9rem; margin-bottom: 0.6rem;">{loc['distance_km']} away &bull; {loc['driving_time']}</p>
                    <p style="color: var(--sapphire-blue); font-size: 0.9rem; font-weight: 600;">View Accommodation Details →</p>
                </a>
            """
            
        cat_sections_html += f"""
            <div style="margin-bottom: 3.5rem;">
                <h2 style="font-size: 1.6rem; color: var(--sapphire-blue-dark); margin-bottom: 1.2rem; display: flex; align-items: center; gap: 0.6rem; border-bottom: 2px solid #E2E8F0; padding-bottom: 0.5rem;">
                    <span>{icon}</span> {cat_name}
                </h2>
                <div class="grid-3">
                    {cards_html}
                </div>
            </div>
        """

    explore_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Explore Nearby Attractions, Wine &amp; Beaches | Cool-Cat Strand</title>
    <meta name="description" content="Discover 30 top destinations, beaches, golf courses, award-winning wine estates, hiking trails, and medical centers near Cool-Cat B&amp;B in Strand, Western Cape.">
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
    <link rel="canonical" href="https://cool-cat.co.za/explore">

    <!-- Geo Meta Tags -->
    <meta name="geo.region" content="ZA-WC">
    <meta name="geo.placename" content="Strand">
    <meta name="geo.position" content="-34.1167;18.8282">
    <meta name="ICBM" content="-34.1167, 18.8282">

    <!-- Open Graph / Facebook -->
    <meta property="og:site_name" content="Cool-Cat">
    <meta property="og:title" content="Explore Nearby Attractions, Wine &amp; Beaches | Cool-Cat Strand">
    <meta property="og:description" content="Explore top destinations, attractions, golf courses, beaches, and wine estates near Cool-Cat in Strand, Western Cape.">
    <meta property="og:image" content="https://cool-cat.co.za/Cool%20Cat%20Banner.jpg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="Cool-Cat Strand">
    <meta property="og:url" content="https://cool-cat.co.za/explore">
    <meta property="og:type" content="website">
    <meta property="og:locale" content="en_ZA">

    <!-- Twitter Cards -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Explore Nearby Attractions, Wine &amp; Beaches | Cool-Cat Strand">
    <meta name="twitter:description" content="Explore top destinations near Cool-Cat in Strand, Western Cape, South Africa.">
    <meta name="twitter:image" content="https://cool-cat.co.za/Cool%20Cat%20Banner.jpg">

    <!-- JSON-LD: CollectionPage + BreadcrumbList -->
    <script type="application/ld+json">
    {{
      "@context": "https://schema.org",
      "@graph": [
        {{
          "@type": "CollectionPage",
          "@id": "https://cool-cat.co.za/explore",
          "name": "Explore Nearby | Cool-Cat Strand",
          "description": "A curated directory of 30 top attractions, beaches, golf courses, hospitals, and wine estates near Cool-Cat in Strand, Western Cape.",
          "url": "https://cool-cat.co.za/explore",
          "publisher": {{
            "@type": "LodgingBusiness",
            "@id": "https://cool-cat.co.za/#bedandbreakfast",
            "name": "Cool-Cat",
            "url": "https://cool-cat.co.za/"
          }}
        }},
        {{
          "@type": "BreadcrumbList",
          "itemListElement": [
            {{
              "@type": "ListItem",
              "position": 1,
              "name": "Home",
              "item": "https://cool-cat.co.za/"
            }},
            {{
              "@type": "ListItem",
              "position": 2,
              "name": "Explore Nearby",
              "item": "https://cool-cat.co.za/explore"
            }}
          ]
        }}
      ]
    }}
    </script>

    <link rel="stylesheet" href="{css_file}">
    <style>
        .page-header {{
            background: linear-gradient(rgba(10, 58, 133, 0.65), rgba(15, 82, 186, 0.75)), url('2. Ocean.jpg') center/cover;
            padding: 12.5rem 1.5rem 4.7rem;
            text-align: center;
            color: white;
            margin-bottom: 1.5rem;
        }}
        .grid-3 {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
        }}
        .location-card {{
            background: var(--white);
            padding: 1.5rem;
            border-radius: 14px;
            box-shadow: var(--shadow-sm);
            border-left: 4px solid var(--orange);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            text-decoration: none;
            display: block;
        }}
        .location-card:hover {{
            transform: translateY(-4px);
            box-shadow: var(--shadow-md);
        }}
    </style>
</head>
<body>
    <header id="navbar">
        <div class="container nav-container">
            <a href="/" class="logo-wrapper">
                <img src="Logo.png" alt="Cool Cat Logo" class="logo-img">
                <span class="logo-text">COOL CAT HOLIDAY ACCOMMODATION</span>
            </a>
            <nav>
                <div class="mobile-menu-btn" onclick="toggleMenu()">☰</div>
                <ul class="nav-links" id="navLinks">
                    <li><a href="/">Home</a></li>
                    <li><a href="/rooms">Accommodation</a></li>
                    <li><a href="/entertainment">Entertainment</a></li>
                    <li><a href="/guide">Guest Guide</a></li>
                    <li><a href="/faq">FAQ &amp; Policies</a></li>
                    
                    <li><a href="/book" class="btn btn-primary" style="padding: 0.5rem 1.5rem; color: white;">Book Now</a></li>
                    <li><button id="reviewsBtn" class="nav-reviews-btn">Reviews</button></li>
                </ul>
            </nav>
        </div>
    </header>

    <div class="page-header">
        <div class="container">
            <h1 style="color: white; font-size: clamp(2rem, 8vw, 3rem); word-break: break-word;">Explore the Western Cape</h1>
            <p style="font-size: 1.2rem; max-width: 650px; margin: 0 auto; line-height: 1.6;">Discover 30 top destinations, beaches, nature reserves, wine estates, and attractions around Cool-Cat in Strand.</p>
        </div>
    </div>

    <section class="section" style="padding-top: 0;">
        <div class="container">
            {cat_sections_html}
        </div>
    </section>
    
    <footer>
        <div class="container">
            <div class="footer-grid">
                <div class="footer-col">
                    <h3>Cool Cat Holiday Accommodation</h3>
                    <p>Your premium bed and breakfast experience in the beautiful coastal town of Strand, Western Cape, South Africa.</p>
                </div>
                <div class="footer-col">
                    <h3>Contact Us</h3>
                    <ul>
                        <li>📱 <span class="footer-contact-info">063 712 4491 (Enquiries)</span></li>
                        <li>💬 <a href="https://wa.me/27637124491" target="_blank">WhatsApp Us</a></li>
                        <li>✉️ <a href="#" onclick="openEmail('bookings@cool-cat.co.za','Booking Inquiry');return false;"><!--email_off-->bookings@cool-cat.co.za<!--/email_off--></a></li>
                        <li>✉️ <a href="#" onclick="openEmail('corrie@cool-cat.co.za','General Inquiry');return false;"><!--email_off-->corrie@cool-cat.co.za<!--/email_off--></a></li>
                    </ul>
                </div>
                <div class="footer-col">
                    <h3>Quick Links</h3>
                    <ul>
                        <li><a href="/rooms">Our Rooms</a></li>
                        <li><a href="/entertainment">Entertainment</a></li>
                        <li><a href="/guide">Guest Guide &amp; Menus</a></li>
                        <li><a href="/explore">Explore Nearby</a></li>
                        <li><a href="/book">Booking Calendar</a></li>
                    </ul>
                </div>
                <div class="footer-col">
                    <h3>Legal &amp; Policies</h3>
                    <ul>
                        <li><a href="/terms">Terms &amp; Conditions</a></li>
                        <li><a href="/privacy">Privacy Policy</a></li>
                        <li><a href="/faq">FAQ &amp; House Rules</a></li>
                        <li><a href="https://www.facebook.com/people/COOL-CAT-BB/61592448388185/" target="_blank">Facebook</a></li>
                    </ul>
                </div>
            </div>
            <div class="footer-bottom" style="line-height: 1.7; font-size: 0.82rem; opacity: 0.9;">
                <div>&copy; 2026 Cool Cat Holiday Accommodation (Pty) Ltd (Reg. No. 2026/626178/07). All rights reserved. &bull; Strand, Western Cape, 7140, South Africa</div>
                <div style="font-size: 0.76rem; color: #94A3B8; margin-top: 0.4rem;">
                    <strong>ECT Act Compliance:</strong> CIPC Reg. 9463921745 &bull; Reg. No. 2026/626178/07 &bull; Physical Location: Strand, Western Cape, 7140 &bull; 
                    <strong>POPIA Notice:</strong> Guest personal and booking data is processed in strict compliance with the South African Protection of Personal Information Act (POPIA) and never shared with third parties.
                </div>
            </div>
        </div>
    </footer>
    <script>
        function openEmail(address, subject) {{
            var isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
            var subjectEncoded = encodeURIComponent(subject);
            if (isMobile) {{
                window.location.href = 'mailto:' + address + '?subject=' + subjectEncoded;
            }} else {{
                window.open('https://mail.google.com/mail/?view=cm&fs=1&to=' + address + '&su=' + subjectEncoded, '_blank');
            }}
        }}

        function toggleMenu() {{
            document.getElementById('navLinks').classList.toggle('active');
        }}
    </script>
</body>
</html>
"""
    with open('explore.html', 'w', encoding='utf-8') as f:
        f.write(explore_content)
        
    # 3. Generate sitemap.xml with all public pages
    print("Generating comprehensive sitemap.xml...")
    base_url = "https://cool-cat.co.za"
    sitemap = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>{base_url}/</loc><lastmod>{today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
    <url><loc>{base_url}/book</loc><lastmod>{today}</lastmod><changefreq>weekly</changefreq><priority>0.95</priority></url>
    <url><loc>{base_url}/rooms</loc><lastmod>{today}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>
    <url><loc>{base_url}/guide</loc><lastmod>{today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
    <url><loc>{base_url}/entertainment</loc><lastmod>{today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
    <url><loc>{base_url}/explore</loc><lastmod>{today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
    <url><loc>{base_url}/faq</loc><lastmod>{today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>
    <url><loc>{base_url}/terms</loc><lastmod>{today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>
    <url><loc>{base_url}/privacy</loc><lastmod>{today}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>
"""
    for loc in locations:
        sitemap += f"    <url><loc>{base_url}/explore/{loc['slug']}</loc><lastmod>{today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>\n"
        
    sitemap += "</urlset>"
    
    with open('sitemap.xml', 'w', encoding='utf-8') as f:
        f.write(sitemap)
        
    print("=========================================")
    print(" Enhanced pSEO Generation Complete!")
    print(f" - {len(locations)} Explore Pages Generated")
    print(" - Categorized explore.html Created")
    print(" - Complete sitemap.xml Generated")
    print("=========================================")

if __name__ == "__main__":
    generate()
