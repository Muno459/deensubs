export function render404() {
  return `<div class="e404">
<div class="e404-geo">
  <svg viewBox="0 0 200 200" fill="none" width="140" height="140">
    <rect x="50" y="50" width="100" height="100" stroke="rgba(196,164,76,.1)" stroke-width="1" transform="rotate(45 100 100)"/>
    <rect x="50" y="50" width="100" height="100" stroke="rgba(196,164,76,.1)" stroke-width="1"/>
    <circle cx="100" cy="100" r="25" stroke="rgba(196,164,76,.06)" stroke-width="1"/>
    <circle cx="100" cy="100" r="8" fill="rgba(196,164,76,.04)"/>
  </svg>
</div>
<h1>404</h1>
<p>This page could not be found.</p>
<p class="e404-sub">The content may have been moved or doesn't exist yet.</p>
<form action="/search" method="get" class="search-page-form" style="margin-top:1rem"><input type="search" name="q" placeholder="Try searching..." autocomplete="off"><button type="submit">Search</button></form>
<div class="e404-actions">
  <a href="/" class="e404-btn e404-primary">Back to Home</a>
  <a href="/scholars" class="e404-btn">Browse Scholars</a>
</div>
</div>`;
}
