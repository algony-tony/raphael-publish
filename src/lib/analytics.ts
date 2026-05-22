// Lightweight GTM dataLayer tracking for blog integration.
// No-op when no GTM/dataLayer is present (e.g. local dev or the standalone deploy).

declare global {
    interface Window {
        dataLayer?: Record<string, unknown>[];
    }
}

/**
 * Push an in-app action to the dataLayer. GTM picks it up via the
 * `raphael_action` custom-event trigger and forwards it to GA4.
 *
 * @param action  short action id, e.g. 'copy', 'export_pdf', 'switch_theme'
 * @param detail  optional context, e.g. the theme id
 */
export function trackAction(action: string, detail?: string): void {
    if (typeof window === 'undefined') return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
        event: 'raphael_action',
        raphael_action: action,
        ...(detail !== undefined ? { raphael_detail: detail } : {}),
    });
}
