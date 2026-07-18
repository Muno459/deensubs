export function render404() {
  return `<div class="e404">
<div class="e404-code" aria-hidden="true">404</div>
<h1>Page not found</h1>
<p>This page could not be found.</p>
<p class="e404-sub">The content may have been moved or doesn't exist yet.</p>
<form action="/search" method="get" class="search-page-form" style="margin-top:1rem"><input type="search" name="q" placeholder="Try searching..." autocomplete="off"><button type="submit">Search</button></form>
<div class="e404-actions">
  <a href="/" class="e404-btn e404-primary">Back to Home</a>
  <a href="/scholars" class="e404-btn">Browse Scholars</a>
</div>
</div>`;
}
