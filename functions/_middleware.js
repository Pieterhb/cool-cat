/**
 * Cloudflare Pages Middleware for cool-cat.co.za
 * Handles backend technical SEO:
 * 1. 301 Permanent Redirect from www to non-www (apex) domain (resolving alternative page canonical errors)
 * 2. 301 Permanent Redirect for legacy test-calendar routes (eliminating redirect chains and loops)
 * 3. 301 Permanent Redirect for common legacy aliases and 404 prevention
 * 4. 301 Trailing-slash normalization for clean canonical URLs
 */
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // 1. Force Apex domain: 301 redirect www.cool-cat.co.za -> cool-cat.co.za
  if (url.hostname === 'www.cool-cat.co.za') {
    const target = new URL(request.url);
    target.hostname = 'cool-cat.co.za';
    return Response.redirect(target.toString(), 301);
  }

  // 2. Direct 301 redirects for test-calendar to avoid redirect chains & loops
  if (url.pathname === '/test-calendar' || url.pathname === '/test-calendar/' || url.pathname === '/test-calendar.html') {
    const target = new URL('/book', request.url);
    return Response.redirect(target.toString(), 301);
  }

  // 3. Direct 301 redirects for common aliases and legacy paths
  const legacyRedirects = {
    '/cancellation-policy': '/cancellation',
    '/cancellation-policy.html': '/cancellation',
    '/terms-and-conditions': '/terms',
    '/terms-and-conditions.html': '/terms',
    '/privacy-policy': '/privacy',
    '/privacy-policy.html': '/privacy',
    '/booking': '/book',
    '/booking.html': '/book',
    '/accommodation': '/rooms',
    '/accommodations': '/rooms',
    '/rates': '/rooms',
    '/rates.html': '/rooms',
    '/pricing': '/rooms',
    '/pricing.html': '/rooms',
    '/contact': '/',
    '/contact.html': '/',
    '/about': '/',
    '/about.html': '/',
    '/cdn-cgi/l/email-protection': '/',
  };

  if (legacyRedirects[url.pathname]) {
    const target = new URL(legacyRedirects[url.pathname], request.url);
    return Response.redirect(target.toString(), 301);
  }

  // 4. Normalize trailing slash for non-root paths (e.g. /rooms/ -> /rooms) with 301
  if (url.pathname.length > 1 && url.pathname.endsWith('/') && !url.pathname.startsWith('/api/')) {
    const cleanPath = url.pathname.slice(0, -1);
    const target = new URL(cleanPath + url.search, request.url);
    return Response.redirect(target.toString(), 301);
  }

  return await next();
}
