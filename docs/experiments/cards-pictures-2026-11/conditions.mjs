// tile#339 measurement — the one set of conditions measure.mjs and record.mjs both use.
// Network: 9 Mbit/s down, 1.5 Mbit/s up, 150 ms added to every request (CDP Network.emulateNetworkConditions).
export const NETWORK = { offline: false, latency: 150, downloadThroughput: 9_000_000 / 8, uploadThroughput: 1_500_000 / 8, connectionType: 'cellular4g' };
// CPU: ×4 slower (CDP Emulation.setCPUThrottlingRate).
export const CPU_RATE = 4;
// A phone: 390×844 CSS px at 3x, touch.
export const DEVICE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
