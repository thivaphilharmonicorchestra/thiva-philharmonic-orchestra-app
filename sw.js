const CACHE_VERSION = 'thiva-philharmonic-v106';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PUSH_OPEN_CACHE = 'thiva-philharmonic-push-open';

const STATIC_ASSETS = [
    './',
    './index.html',
    './thiva_app_icon.png',
    './thiva_app_icon_android.png',
    './thiva_home_button.png',
    './manifest.webmanifest',
    './vendor/tailwind.js',
    './vendor/supabase.min.js',
    './vendor/pdf.min.js',
    './vendor/pdf.worker.min.js',
    './vendor/pdf-lib.min.js',
    './vendor/NoSleep.min.js'
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
                keys.filter(k => !k.startsWith(CACHE_VERSION) && k !== PUSH_OPEN_CACHE).map(k => caches.delete(k))
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

function isNavigationRequest(req) {
    return req.mode === 'navigate' || (req.destination === 'document');
}

function isCachedShellRequest(url) {
    if (url.origin === location.origin) return true;
    return false;
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    if (req.method !== 'GET') return;

    if (isPdfRequest(url.href) || (req.headers.get('accept') || '').includes('application/pdf') || isSupabaseApi(url.href)) {
        return;
    }

    if (isNavigationRequest(req)) {
        event.respondWith((async () => {
            const cached = (await caches.match('./index.html')) || (await caches.match('./'));
            const network = fetch(req, { cache: 'no-store' }).then((resp) => {
                if (resp.ok) {
                    caches.open(STATIC_CACHE).then((c) => c.put('./index.html', resp.clone())).catch(() => {});
                }
                return resp;
            });
            if (!cached) {
                try {
                    return await network;
                } catch {
                    return Response.error();
                }
            }
            const fresh = await Promise.race([
                network.then((resp) => (resp && resp.ok ? resp : null)).catch(() => null),
                new Promise((resolve) => setTimeout(() => resolve(null), 3000))
            ]);
            if (fresh) return fresh;
            network.catch(() => {});
            return cached;
        })());
        return;
    }

    if (!isCachedShellRequest(url)) return;

    event.respondWith((async () => {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        try {
            const resp = await fetch(req);
            if (resp.ok) {
                const cache = await caches.open(STATIC_CACHE);
                cache.put(req, resp.clone()).catch(() => {});
            }
            return resp;
        } catch {
            return new Response('', { status: 504, statusText: 'Offline' });
        }
    })());
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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
        data: {
            url: safeNotificationUrl(data.data && data.data.url),
            title: data.title || 'Φιλαρμονική Ορχήστρα Θήβας',
            body: data.body || ''
        },
        silent: false
    };

    const title = data.title || 'Φιλαρμονική Ορχήστρα Θήβας';
    event.waitUntil(self.registration.showNotification(title, options));
});

function stashPushOpen(title, body) {
    const payload = JSON.stringify({
        title: title || '',
        body: body || '',
        at: Date.now()
    });
    return caches.open(PUSH_OPEN_CACHE).then((cache) => cache.put(
        'last',
        new Response(payload, { headers: { 'Content-Type': 'application/json' } })
    ));
}

function notifyClientsPushOpen(title, body) {
    return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        clients.forEach((c) => {
            try {
                c.postMessage({ type: 'thiva-push-open', title: title || '', body: body || '' });
            } catch (e) {}
        });
    });
}

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const nd = event.notification.data || {};
    const url = safeNotificationUrl(nd.url);
    const title = nd.title || event.notification.title || '';
    const body = nd.body || event.notification.body || '';
    event.waitUntil(
        stashPushOpen(title, body).then(() =>
            self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
                const existing = clients.find((c) => 'focus' in c);
                if (existing) {
                    const focused = existing.focus();
                    const opened = typeof existing.navigate === 'function'
                        ? focused.then(() => existing.navigate(url))
                        : focused.then(() => {
                            try {
                                existing.postMessage({ type: 'thiva-push-open', title, body, url });
                            } catch (e) {}
                        });
                    return opened.then(() => notifyClientsPushOpen(title, body));
                }
                if (self.clients.openWindow) return self.clients.openWindow(url);
            })
        )
    );
});
