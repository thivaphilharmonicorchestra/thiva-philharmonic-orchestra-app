const CACHE_VERSION = 'thiva-philharmonic-v56';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const STATIC_ASSETS = [
    './',
    './index.html',
    './thiva_app_icon.png',
    './thiva_app_icon_android.png',
    './thiva_home_button.png',
    './manifest.webmanifest',
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    'https://raw.githubusercontent.com/thivaphilharmonic-maker/thiva-philharmonic-orchestra-app/main/logo.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch(err => {
                console.warn('Some static assets failed to cache:', err);
                return Promise.all(STATIC_ASSETS.map(url =>
                    cache.add(url).catch(e => console.warn('Skip:', url, e))
                ));
            });
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

function isPdfRequest(url) {
    return url.endsWith('.pdf') ||
        (url.includes('supabase') && (url.includes('sheet-music') || url.includes('storage'))) ||
        (url.includes('token=') && (url.includes('pdf') || url.includes('render')));
}

function isSupabaseApi(url) {
    try {
        return new URL(url).hostname.endsWith('supabase.co');
    } catch {
        return false;
    }
}

function safeNotificationUrl(raw) {
    const fallback = new URL('./index.html', self.registration.scope).href;
    try {
        const resolved = new URL(String(raw || ''), self.registration.scope);
        if (resolved.origin !== self.location.origin) return fallback;
        return resolved.href;
    } catch {
        return fallback;
    }
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    if (req.method !== 'GET') return;

    if (isPdfRequest(url.href) || (req.headers.get('accept') || '').includes('application/pdf') || isSupabaseApi(url.href)) {
        event.respondWith(
            fetch(req).catch(() => new Response('Unavailable', { status: 503, statusText: 'Unavailable' }))
        );
        return;
    }

    if (url.origin === location.origin || STATIC_ASSETS.includes(url.href) || STATIC_ASSETS.includes(url.pathname)) {
        event.respondWith(
            fetch(req).then((resp) => {
                if (resp.ok) {
                    caches.open(STATIC_CACHE).then(c => c.put(req, resp.clone())).catch(() => {});
                }
                return resp;
            }).catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))
        );
        return;
    }
});

self.addEventListener('push', (event) => {
    let data = { title: 'Φιλαρμονική Ορχήστρα Θήβας', body: 'Νέα ανακοίνωση' };
    try {
        if (event.data) {
            const parsed = event.data.json();
            data = { ...data, ...parsed };
        }
    } catch (e) {
        if (event.data) data.body = event.data.text();
    }

    const options = {
        body: data.body,
        icon: data.icon || `${self.registration.scope}thiva_app_icon.png`,
        badge: data.badge || `${self.registration.scope}thiva_app_icon.png`,
        vibrate: [200, 100, 200],
        tag: data.tag || 'thiva-philharmonic-notification',
        data: { url: safeNotificationUrl(data.data && data.data.url) },
        silent: false
    };

    const title = data.title || 'Φιλαρμονική Ορχήστρα Θήβας';
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = safeNotificationUrl(event.notification.data && event.notification.data.url);
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            for (const c of clients) {
                if ('focus' in c) {
                    return c.focus().then(() => c.navigate(url));
                }
            }
            if (self.clients.openWindow) return self.clients.openWindow(url);
        })
    );
});
