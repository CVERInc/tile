// Types for preview-bar.mjs, shipped beside it so a TypeScript consumer of a verbatim copy can import it.
export const PREVIEW_BAR_ID: 'feelreef-preview-bar';
export const PREVIEW_BAR_PLATFORM: 'https://feelreef.com';
export type PreviewBarLocale = 'zh-TW' | 'ja' | 'en';
export const PREVIEW_BAR_LOCALES: readonly PreviewBarLocale[];
export type PreviewBarWords = { readonly label: string; readonly message: string; readonly edit: string; readonly publish: string };
export const PREVIEW_BAR_COPY: Readonly<Record<PreviewBarLocale, PreviewBarWords>>;
export function previewBarLocale(pageLang: string | null | undefined): PreviewBarLocale;
export const PREVIEW_BAR_CSS: string;
export function previewBarHtml(o: { pageLang?: string | null; editHref: string; publishHref: string }): string;
export function sitePreviewBarHtml(siteKey: string, pageLang: string | null, platform?: string): string;
export function cardsPreviewBarHtml(handle: string, previewId: string, pageLang: string | null, platform?: string): string;
export const PREVIEW_NO_BAR_HEADER: 'x-feelreef-no-preview-bar';
export const PREVIEW_NO_BAR_VALUE: '1';
export function wantsPreviewBar(headers: { get(name: string): string | null } | null | undefined): boolean;
export function withPreviewBar(html: string, barFor: (pageLang: string | null) => string): string;
