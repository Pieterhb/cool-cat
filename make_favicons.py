from PIL import Image

try:
    img = Image.open('Logo.png')
    
    # Make sure it's square if possible by cropping to the center
    width, height = img.size
    if width != height:
        new_size = min(width, height)
        left = (width - new_size)/2
        top = (height - new_size)/2
        right = (width + new_size)/2
        bottom = (height + new_size)/2
        img = img.crop((left, top, right, bottom))
    
    # Save favicon.ico (can contain multiple sizes, but 32x32 is good)
    icon_sizes = [(16,16), (32, 32), (48, 48), (64,64)]
    img.save('favicon.ico', sizes=icon_sizes)
    
    # Save apple-touch-icon.png (180x180)
    img_resized = img.resize((180, 180), Image.Resampling.LANCZOS)
    img_resized.save('apple-touch-icon.png', format="PNG")
    print("Successfully created favicon.ico and apple-touch-icon.png")
except Exception as e:
    print(f"Error: {e}")
